"""
StarScope Python Sidecar。
為 Tauri 桌面應用提供資料引擎的 FastAPI 伺服器。
"""

import os
import logging
import uvicorn
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# 從 .env 檔載入環境變數
load_dotenv()

from constants import DEFAULT_FETCH_INTERVAL_MINUTES, GITHUB_TOKEN_ENV_VAR
from middleware import LoggingMiddleware
from services.github import GitHubAPIError, GitHubNotFoundError, GitHubRateLimitError

# 環境設定
DEBUG = os.getenv("DEBUG", "false").lower() in ("true", "1", "yes")
ENV = os.getenv("ENV", "development")
from logging_config import setup_logging
from routers import health, repos, scheduler, alerts, trends, context, charts, recommendations, categories, early_signals, export, github_auth, discovery, commit_activity, languages, star_history
from db import init_db
from services.scheduler import start_scheduler, stop_scheduler, trigger_fetch_now

# 最優先設定 logging
setup_logging(level="INFO")


from typing import AsyncGenerator

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    """
    應用程式生命週期處理器。
    啟動時初始化資料庫並啟動排程器。
    """
    # 檢查 GitHub token（從 DB 的 OAuth 或環境變數）
    github_token = os.getenv(GITHUB_TOKEN_ENV_VAR)
    has_oauth_token = False
    try:
        from services.settings import get_setting
        from db.models import AppSettingKey
        has_oauth_token = get_setting(AppSettingKey.GITHUB_TOKEN) is not None
    except (ImportError, AttributeError, OSError):
        pass  # DB 尚未初始化或模組不可用，稍後再檢查

    if not github_token and not has_oauth_token:
        logger.warning(
            "[啟動] 未設定 GitHub token，"
            "API 速率限制較低 (60 requests/hour)，"
            "請至設定頁面連結 GitHub 帳號以提高上限"
        )
    else:
        logger.info("[啟動] GitHub token 已設定")

    # 啟動：初始化資料庫
    init_db()

    # 啟動背景排程器
    start_scheduler(fetch_interval_minutes=DEFAULT_FETCH_INTERVAL_MINUTES)

    # 啟動後立即抓取資料（不等第一個排程週期）
    import asyncio
    asyncio.ensure_future(trigger_fetch_now())

    logger.info(f"[啟動] StarScope Engine 已啟動 (ENV={ENV}, DEBUG={DEBUG})")

    yield

    # 關閉：停止排程器
    stop_scheduler()
    logger.info("[啟動] StarScope Engine 已停止")


app = FastAPI(
    title="StarScope Engine",
    description="GitHub Project Intelligence API",
    version="0.1.0",
    lifespan=lifespan,
)

# GitHub API 錯誤的全域例外處理器。
# 避免在各 router 中重複 try/except。
from fastapi import Request
from fastapi.responses import JSONResponse


@app.exception_handler(GitHubNotFoundError)
async def github_not_found_handler(_request: Request, exc: GitHubNotFoundError):
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(GitHubRateLimitError)
async def github_rate_limit_handler(_request: Request, _exc: GitHubRateLimitError):
    return JSONResponse(
        status_code=429,
        content={"detail": "GitHub API rate limit exceeded. Please try again later."},
    )


@app.exception_handler(GitHubAPIError)
async def github_api_error_handler(_request: Request, exc: GitHubAPIError):
    return JSONResponse(status_code=502, content={"detail": f"GitHub API error: {exc}"})


# CORS 設定 — 允許 Tauri 前端呼叫此 API
# 明確限制 methods 與 headers 以提升安全性
def get_allowed_origins() -> list[str]:
    """
    根據環境取得允許的 CORS origins。
    正式環境排除 localhost 開發伺服器以提升安全性。
    """
    origins = [
        "tauri://localhost",       # Tauri 正式環境 (macOS/Linux)
        "https://tauri.localhost", # Tauri Windows 環境
    ]
    if ENV != "production":
        origins.append("http://localhost:1420")  # Vite 開發伺服器
    return origins


ALLOWED_ORIGINS = get_allowed_origins()

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
    allow_headers=["Content-Type", "Authorization", "Accept"],
)

# Request/Response 日誌 middleware
app.add_middleware(
    LoggingMiddleware,
    exclude_paths=["/api/health", "/"],
    log_headers=DEBUG,  # 僅在 debug 模式記錄 headers
)

# 註冊 routers
app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(repos.router, prefix="/api", tags=["repos"])
app.include_router(scheduler.router, tags=["scheduler"])
app.include_router(alerts.router, tags=["alerts"])
app.include_router(trends.router, tags=["trends"])
app.include_router(context.router, prefix="/api", tags=["context"])
app.include_router(charts.router, prefix="/api", tags=["charts"])
app.include_router(recommendations.router, prefix="/api", tags=["recommendations"])
app.include_router(categories.router, prefix="/api", tags=["categories"])
app.include_router(early_signals.router, prefix="/api", tags=["early-signals"])
app.include_router(export.router, prefix="/api", tags=["export"])
app.include_router(github_auth.router, prefix="/api", tags=["github-auth"])
app.include_router(discovery.router, prefix="/api", tags=["discovery"])
app.include_router(commit_activity.router, prefix="/api", tags=["commit-activity"])
app.include_router(languages.router, prefix="/api", tags=["languages"])
app.include_router(star_history.router, prefix="/api", tags=["star-history"])


@app.get("/")
async def root():
    return {"message": "StarScope Engine is running"}


if __name__ == "__main__":
    # 僅在開發模式啟用 hot reload
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=int(os.getenv("PORT", "8008")),
        reload=DEBUG,  # DEBUG=true 時才啟用 hot reload
    )
