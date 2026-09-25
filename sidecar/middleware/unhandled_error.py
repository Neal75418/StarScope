"""
把沒接住的例外轉成 JSON 500，讓它經過 CORSMiddleware。

Starlette 對沒接住的例外由最外層的 ServerErrorMiddleware 回 500，它在所有
add_middleware 的外面，那個回應不會帶 CORS header。前端是跨來源呼叫 sidecar，
讀不到回應就只能顯示「Network error」，跟 sidecar 掛掉分不出來。
@app.exception_handler(Exception) 也一樣掛在 ServerErrorMiddleware 上，繞不開。

回應不帶例外訊息：訊息裡可能有本機路徑或 SQL，traceback 只進日誌。
"""

import logging

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

logger = logging.getLogger("starscope.middleware")


class UnhandledErrorMiddleware(BaseHTTPMiddleware):
    """接住 route 與內層 middleware 拋出的例外，回 500。"""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        try:
            return await call_next(request)
        except Exception:
            logger.exception("[UnhandledError] %s %s", request.method, request.url.path)
            return JSONResponse(status_code=500, content={"detail": "Internal server error"})
