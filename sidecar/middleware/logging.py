"""StarScope 的 Request/Response 日誌 middleware。"""

import time
import logging
import uuid

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.types import ASGIApp

logger = logging.getLogger("starscope.middleware")


class LoggingMiddleware(BaseHTTPMiddleware):
    """
    記錄 request 與 response 細節的 middleware。

    記錄內容：
    - Request：method、path、request ID
    - Response：status code、回應時間
    - Error：例外詳情與 stack trace
    """

    def __init__(
        self,
        app: ASGIApp,
        exclude_paths: list[str] | None = None,
        slow_request_threshold_ms: float = 1000.0,
    ):
        """
        初始化日誌 middleware。

        Args:
            app: ASGI 應用程式
            exclude_paths: 排除日誌記錄的路徑列表（例如 health check）
            slow_request_threshold_ms: 慢請求警告門檻（毫秒，預設 1000ms）
        """
        super().__init__(app)
        self.exclude_paths = exclude_paths or ["/api/health", "/"]
        self.slow_request_threshold_ms = slow_request_threshold_ms

    def _should_exclude(self, path: str) -> bool:
        """檢查路徑是否應排除日誌記錄。"""
        # 移除尾部斜線以正規化路徑
        normalized_path = path.rstrip("/") or "/"
        for excluded in self.exclude_paths:
            excluded_normalized = excluded.rstrip("/") or "/"
            if normalized_path == excluded_normalized:
                return True
        return False

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        """處理 request 並記錄詳情。"""
        if self._should_exclude(request.url.path):
            response: Response = await call_next(request)
            return response

        request_id = str(uuid.uuid4())[:8]

        self._log_request(request, request_id)

        start_time = time.perf_counter()

        try:
            response = await call_next(request)
            duration_ms = (time.perf_counter() - start_time) * 1000

            self._log_response(request, response, request_id, duration_ms)

            # 將 request ID 加入 response headers 以利除錯
            response.headers["X-Request-ID"] = request_id

            return response

        except Exception as e:
            duration_ms = (time.perf_counter() - start_time) * 1000
            self._log_error(request, request_id, duration_ms, e)
            raise

    @staticmethod
    def _log_request(request: Request, request_id: str) -> None:
        """記錄收到的 request。只記方法與路徑：query 與 headers 可能帶祕密，不進 log。"""
        logger.info(f"[{request_id}] --> {request.method} {request.url.path}")

    def _log_response(
        self,
        request: Request,
        response: Response,
        request_id: str,
        duration_ms: float,
    ) -> None:
        """記錄送出的 response 詳情。"""
        status = response.status_code
        is_slow = duration_ms >= self.slow_request_threshold_ms

        # 決定日誌等級：server error > 慢請求 > client error > 正常
        if status >= 500:
            log_level = logging.ERROR
        elif is_slow:
            log_level = logging.WARNING
        elif status >= 400:
            log_level = logging.WARNING
        else:
            log_level = logging.INFO

        # 建立含慢請求標記的日誌訊息
        slow_indicator = " [慢請求]" if is_slow else ""
        log_message = (
            f"[{request_id}] <-- {request.method} {request.url.path} "
            f"{status} ({duration_ms:.2f}ms){slow_indicator}"
        )

        logger.log(log_level, log_message)

    @staticmethod
    def _log_error(
        request: Request,
        request_id: str,
        duration_ms: float,
        e: Exception,
    ) -> None:
        """記錄錯誤詳情與例外資訊。"""
        # 這是 except 區塊呼叫的 helper，不在 except 語法內：把例外物件明確交給 exc_info
        logger.error(
            f"[{request_id}] <-- {request.method} {request.url.path} "
            f"錯誤 ({duration_ms:.2f}ms): {e}",
            exc_info=e,
        )
