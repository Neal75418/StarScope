"""
StarScope Python Sidecar。
為 Tauri 桌面應用提供資料引擎的 FastAPI 伺服器。
"""

import os
import logging
import time
import uvicorn
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded

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
from db.database import get_app_data_dir
from services.scheduler import start_scheduler, stop_scheduler, trigger_fetch_now

# 最優先設定 logging（非開發 debug 模式時寫入檔案）
_log_dir = str(get_app_data_dir()) if not DEBUG else None
setup_logging(level="INFO", log_dir=_log_dir)


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
    # 保留 task 參照以防止 GC 回收
    import asyncio
    _startup_task = asyncio.create_task(trigger_fetch_now())

    logger.info(f"[啟動] StarScope Engine 已啟動 (ENV={ENV}, DEBUG={DEBUG})")

    yield

    # 關閉：停止排程器
    stop_scheduler()
    logger.info("[啟動] StarScope Engine 已停止")


from middleware.rate_limit import limiter

app = FastAPI(
    title="StarScope API",
    description="""
    ## GitHub 專案追蹤與趨勢分析 API

    StarScope 提供強大的 GitHub 專案情報分析能力，幫助工程師識別專案動能和早期訊號。

    ### 核心功能

    - **追蹤清單管理**: 管理追蹤的 GitHub 專案
    - **速度分析**: 計算 star 增長速度和加速度
    - **早期訊號偵測**: 識別異常增長模式
    - **趨勢分析**: 7/30 天趨勢追蹤
    - **相似專案推薦**: 基於 topics 和語言的智慧推薦
    - **Hacker News 整合**: 追蹤專案在 HN 的討論

    ### 認證

    支援兩種認證方式：
    1. **OAuth Device Flow** (推薦) - 透過 `/api/github-auth/device-code` 啟動
    2. **Personal Access Token** - 透過環境變數 `GITHUB_TOKEN`

    ### 速率限制

    - 預設: 120 requests/minute
    - GitHub API: 遵循官方限制（5000/hour 已認證, 60/hour 未認證）

    ### 資料更新

    - 背景排程器每小時自動更新所有追蹤專案
    - 支援手動觸發更新 (`POST /api/repos/{id}/fetch`)
    """,
    version="0.3.0",
    lifespan=lifespan,
    # OpenAPI 配置
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    # 聯絡資訊
    contact={
        "name": "StarScope Team",
        "url": "https://github.com/Neal75418/StarScope",
        "email": "support@starscope.example.com"
    },
    # 授權資訊
    license_info={
        "name": "MIT License",
        "url": "https://opensource.org/licenses/MIT",
    },
    # 伺服器資訊
    servers=[
        {
            "url": "http://localhost:8008",
            "description": "開發環境"
        },
        {
            "url": "http://127.0.0.1:8008",
            "description": "本地環境"
        }
    ],
    # 標籤元數據
    openapi_tags=[
        {
            "name": "health",
            "description": "健康檢查和服務狀態"
        },
        {
            "name": "repos",
            "description": "專案追蹤清單管理（CRUD 操作）"
        },
        {
            "name": "early-signals",
            "description": "早期訊號偵測與管理"
        },
        {
            "name": "trends",
            "description": "趨勢分析與速度計算"
        },
        {
            "name": "discovery",
            "description": "專案發現與推薦"
        },
        {
            "name": "github-auth",
            "description": "GitHub OAuth 認證流程"
        },
        {
            "name": "export",
            "description": "資料匯出"
        },
    ],
)
app.state.limiter = limiter
def _handle_rate_limit(_request: "Request", exc: Exception):
    from fastapi.responses import JSONResponse
    detail = exc.detail if isinstance(exc, RateLimitExceeded) else str(exc)
    return JSONResponse(
        status_code=429,
        content={"detail": f"Rate limit exceeded: {detail}"},
    )

app.add_exception_handler(RateLimitExceeded, _handle_rate_limit)

# GitHub API 錯誤的全域例外處理器。
# 避免在各 router 中重複 try/except。
from fastapi import Request
from fastapi.responses import JSONResponse


@app.exception_handler(GitHubNotFoundError)
async def github_not_found_handler(_request: Request, exc: GitHubNotFoundError):
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(GitHubRateLimitError)
async def github_rate_limit_handler(_request: Request, exc: GitHubRateLimitError):
    headers = {}
    if exc.reset_at:
        retry_after = max(0, exc.reset_at - int(time.time()))
        headers["Retry-After"] = str(retry_after)
    return JSONResponse(
        status_code=429,
        content={"detail": "GitHub API rate limit exceeded. Please try again later."},
        headers=headers,
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

# 註冊 routers（prefix 與 tags 均定義在各 router 內部）
for _module in [
    health, repos, scheduler, alerts, trends, context, charts,
    recommendations, categories, early_signals, export, github_auth,
    discovery, commit_activity, languages, star_history,
]:
    app.include_router(_module.router)


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
