"""
本機請求守衛：擋掉瀏覽器裡「別的網站」對 sidecar 發出的請求。

SessionAuthMiddleware 只在 Tauri 注入 secret 時生效；手動啟動的 sidecar
（start-dev.sh、e2e）沒有 secret，會整個放行。那時任何網頁都能對
127.0.0.1:8008 發 no-cors POST，而 /api/repos/{id}/unstar 這類端點會用
使用者的 GitHub token 取消 star。這一層不依賴 secret，兩種模式都掛：

- Host 必須是 127.0.0.1 或 localhost（不限 port）。DNS rebinding 的請求
  會連到 127.0.0.1，但 Host 仍是攻擊者的網域。
- 帶了 Origin 就必須在 CORS 允許清單裡。瀏覽器對跨站的非 GET 請求一律
  帶 Origin，no-cors 也一樣，所以跨站 POST 過不了這關。沒帶 Origin 的是
  非瀏覽器客戶端（curl、健康檢查）或頁面導覽式的 GET（GET 導覽本來就不帶 Origin），放行。

跨站 GET（例如 <img src>）不帶 Origin，這一層擋不住——所以 GET 端點
不能改資料、也不能寫 GitHub。
"""

import logging
from collections.abc import Iterable

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response
from starlette.types import ASGIApp

logger = logging.getLogger("starscope.middleware")

_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost"})


class LocalRequestGuardMiddleware(BaseHTTPMiddleware):
    """拒絕 Host 不是 loopback、或 Origin 不在允許清單裡的請求。"""

    def __init__(self, app: ASGIApp, allowed_origins: Iterable[str]) -> None:
        super().__init__(app)
        self._allowed_origins = frozenset(allowed_origins)

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        hostname = request.headers.get("host", "").rsplit(":", 1)[0]
        if hostname not in _LOOPBACK_HOSTS:
            return self._reject(request, f"host {hostname!r}")

        origin = request.headers.get("origin")
        if origin is not None and origin not in self._allowed_origins:
            return self._reject(request, f"origin {origin!r}")

        return await call_next(request)

    @staticmethod
    def _reject(request: Request, reason: str) -> Response:
        logger.warning("[LocalRequestGuard] 拒絕 %s %s：%s",
                       request.method, request.url.path, reason)
        return JSONResponse(status_code=403, content={"detail": "Forbidden: non-local request"})
