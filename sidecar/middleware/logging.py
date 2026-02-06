"""StarScope 的 Request/Response 日誌 middleware。"""

import time
import logging
import uuid
from typing import Any, Callable, List, Optional

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

logger = logging.getLogger("starscope.middleware")


class LoggingMiddleware(BaseHTTPMiddleware):
    """
    記錄 request 與 response 細節的 middleware。

    記錄內容：
    - Request：method、path、client IP、request ID
    - Response：status code、回應時間
    - Error：例外詳情與 stack trace
    """

    def __init__(
        self,
        app: ASGIApp,
        exclude_paths: Optional[List[str]] = None,
        log_headers: bool = False,
        slow_request_threshold_ms: float = 1000.0,
    ):
        """
        初始化日誌 middleware。

        Args:
            app: ASGI 應用程式
            exclude_paths: 排除日誌記錄的路徑列表（例如 health check）
            log_headers: 是否記錄 request headers（預設關閉以保障安全）
            slow_request_threshold_ms: 慢請求警告門檻（毫秒，預設 1000ms）
        """
        super().__init__(app)
        self.exclude_paths = exclude_paths or ["/api/health", "/"]
        self.log_headers = log_headers
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
        self, request: Request, call_next: Callable
    ) -> Response:
        """處理 request 並記錄詳情。"""
        # 跳過排除路徑的日誌記錄
        if self._should_exclude(request.url.path):
            return await call_next(request)

        # 產生唯一 request ID 用於追蹤
        request_id = str(uuid.uuid4())[:8]

        # 取得 client 資訊
        client_ip = self._get_client_ip(request)

        # 記錄 request
        self._log_request(request, request_id, client_ip)

        # 追蹤回應時間
        start_time = time.perf_counter()

        try:
            response = await call_next(request)
            duration_ms = (time.perf_counter() - start_time) * 1000

            # 記錄 response
            self._log_response(request, response, request_id, duration_ms)

            # 將 request ID 加入 response headers 以利除錯
            response.headers["X-Request-ID"] = request_id

            return response

        except Exception as exc:
            duration_ms = (time.perf_counter() - start_time) * 1000
            self._log_error(request, request_id, duration_ms, exc)
            raise

    @staticmethod
    def _get_client_ip(request: Request) -> str:
        """從 request 提取 client IP，處理 proxy 情況。"""
        # 檢查轉發 header（來自 reverse proxy）
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()

        # 檢查 real IP header
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            return real_ip

        # 回退至直接 client
        if request.client:
            return request.client.host

        return "unknown"

    def _log_request(
        self, request: Request, request_id: str, client_ip: str
    ) -> None:
        """記錄收到的 request 詳情。"""
        log_data: dict[str, Any] = {
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "client_ip": client_ip,
        }

        # 如有 query 參數則加入
        if request.url.query:
            log_data["query"] = request.url.query

        # 選擇性記錄 headers（遮蔽敏感資料）
        if self.log_headers:
            headers = dict(request.headers)
            # 遮蔽敏感 headers
            for key in ["authorization", "cookie", "x-api-key"]:
                if key in headers:
                    headers[key] = "***"
            log_data["headers"] = headers

        logger.info(
            f"[{request_id}] --> {request.method} {request.url.path}",
            extra=log_data,
        )

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

        logger.log(
            log_level,
            log_message,
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": status,
                "duration_ms": round(duration_ms, 2),
                "is_slow": is_slow,
            },
        )

    @staticmethod
    def _log_error(
        request: Request,
        request_id: str,
        duration_ms: float,
        exc: Exception,
    ) -> None:
        """記錄錯誤詳情與例外資訊。"""
        logger.error(
            f"[{request_id}] <-- {request.method} {request.url.path} "
            f"錯誤 ({duration_ms:.2f}ms): {exc}",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "duration_ms": round(duration_ms, 2),
                "error": str(exc),
                "error_type": type(exc).__name__,
            },
            exc_info=True,
        )
