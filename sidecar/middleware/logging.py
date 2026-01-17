"""
Request/Response logging middleware for StarScope.
"""

import time
import logging
import uuid
from typing import Callable, List, Optional

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

logger = logging.getLogger("starscope.middleware")


class LoggingMiddleware(BaseHTTPMiddleware):
    """
    Middleware that logs request and response details.

    Logs include:
    - Request: method, path, client IP, request ID
    - Response: status code, response time
    - Errors: exception details with stack trace
    """

    def __init__(
        self,
        app: ASGIApp,
        exclude_paths: Optional[List[str]] = None,
        log_headers: bool = False,
        slow_request_threshold_ms: float = 1000.0,
    ):
        """
        Initialize the logging middleware.

        Args:
            app: The ASGI application
            exclude_paths: List of paths to exclude from logging (e.g., health checks)
            log_headers: Whether to log request headers (disabled by default for security)
            slow_request_threshold_ms: Threshold in ms to log slow request warnings (default: 1000ms)
        """
        super().__init__(app)
        self.exclude_paths = exclude_paths or ["/api/health", "/"]
        self.log_headers = log_headers
        self.slow_request_threshold_ms = slow_request_threshold_ms

    def _should_exclude(self, path: str) -> bool:
        """Check if the path should be excluded from logging."""
        # Normalize path by removing trailing slash
        normalized_path = path.rstrip("/") or "/"
        for excluded in self.exclude_paths:
            excluded_normalized = excluded.rstrip("/") or "/"
            if normalized_path == excluded_normalized:
                return True
        return False

    async def dispatch(
        self, request: Request, call_next: Callable
    ) -> Response:
        """Process the request and log details."""
        # Skip logging for excluded paths
        if self._should_exclude(request.url.path):
            return await call_next(request)

        # Generate unique request ID for tracing
        request_id = str(uuid.uuid4())[:8]

        # Get client info
        client_ip = self._get_client_ip(request)

        # Log request
        self._log_request(request, request_id, client_ip)

        # Track response time
        start_time = time.perf_counter()

        try:
            response = await call_next(request)
            duration_ms = (time.perf_counter() - start_time) * 1000

            # Log response
            self._log_response(request, response, request_id, duration_ms)

            # Add request ID to response headers for debugging
            response.headers["X-Request-ID"] = request_id

            return response

        except Exception as exc:
            duration_ms = (time.perf_counter() - start_time) * 1000
            self._log_error(request, request_id, duration_ms, exc)
            raise

    def _get_client_ip(self, request: Request) -> str:
        """Extract client IP from request, handling proxies."""
        # Check for forwarded header (from reverse proxy)
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()

        # Check for real IP header
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            return real_ip

        # Fall back to direct client
        if request.client:
            return request.client.host

        return "unknown"

    def _log_request(
        self, request: Request, request_id: str, client_ip: str
    ) -> None:
        """Log incoming request details."""
        log_data = {
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "client_ip": client_ip,
        }

        # Add query params if present
        if request.url.query:
            log_data["query"] = request.url.query

        # Optionally log headers (with sensitive data masked)
        if self.log_headers:
            headers = dict(request.headers)
            # Mask sensitive headers
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
        """Log outgoing response details."""
        status = response.status_code
        is_slow = duration_ms >= self.slow_request_threshold_ms

        # Determine log level: error status > slow request > client error > normal
        if status >= 500:
            log_level = logging.ERROR
        elif is_slow:
            log_level = logging.WARNING
        elif status >= 400:
            log_level = logging.WARNING
        else:
            log_level = logging.INFO

        # Build log message with slow request indicator
        slow_indicator = " [SLOW]" if is_slow else ""
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

    def _log_error(
        self,
        request: Request,
        request_id: str,
        duration_ms: float,
        exc: Exception,
    ) -> None:
        """Log error details with exception info."""
        logger.error(
            f"[{request_id}] <-- {request.method} {request.url.path} "
            f"ERROR ({duration_ms:.2f}ms): {exc}",
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
