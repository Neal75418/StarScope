"""
Per-session secret 驗證 middleware。

Tauri 啟動 sidecar 時透過環境變數 STARSCOPE_SESSION_SECRET 傳入隨機 secret，
前端透過 Tauri command 取得同一 secret 後附加至每個 API 請求的
X-Session-Secret header。此 middleware 驗證該 header 以確保只有本機
Tauri 前端能呼叫 sidecar API，防止其他本機程序或惡意網頁存取。

開發模式（未設定 secret）時跳過驗證，不影響 start-dev.sh 流程。
"""

import hmac
import logging
import os

from collections.abc import Callable

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from starlette.types import ASGIApp

logger = logging.getLogger("starscope.middleware")

# 環境變數名稱
_SECRET_ENV_VAR = "STARSCOPE_SESSION_SECRET"

# 免驗證路徑（健康檢查供外部監控使用）
_EXEMPT_PATHS = frozenset({"/api/health", "/"})

# 請求 header 名稱
SESSION_SECRET_HEADER = "X-Session-Secret"


class SessionAuthMiddleware(BaseHTTPMiddleware):
    """驗證每個請求的 X-Session-Secret header 是否與啟動時的 secret 一致。"""

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)
        self._secret: str | None = os.getenv(_SECRET_ENV_VAR)
        if self._secret:
            logger.info("[SessionAuth] 已啟用 per-session secret 驗證")
        else:
            logger.warning(
                "[SessionAuth] 未設定 %s，跳過驗證（僅限開發模式）",
                _SECRET_ENV_VAR,
            )

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # 未設定 secret 時（開發模式）跳過驗證
        if not self._secret:
            return await call_next(request)

        # 免驗證路徑
        if request.url.path in _EXEMPT_PATHS:
            return await call_next(request)

        # CORS preflight（OPTIONS）不含自訂 header，必須放行
        if request.method == "OPTIONS":
            return await call_next(request)

        # 驗證 header
        provided = request.headers.get(SESSION_SECRET_HEADER)
        if not provided or not hmac.compare_digest(provided, self._secret):
            logger.warning(
                "[SessionAuth] 拒絕未授權請求: %s %s (from %s)",
                request.method,
                request.url.path,
                request.client.host if request.client else "unknown",
            )
            return JSONResponse(
                status_code=403,
                content={"detail": "Forbidden: invalid session secret"},
            )

        return await call_next(request)
