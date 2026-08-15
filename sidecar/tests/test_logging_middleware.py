"""LoggingMiddleware 測試：透過真實 ASGI 請求驗證行為（不直接戳內部清單）。"""

import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from middleware.logging import LoggingMiddleware


def _build_app(**middleware_kwargs) -> TestClient:
    app = FastAPI()
    app.add_middleware(LoggingMiddleware, **middleware_kwargs)

    @app.get("/api/echo")
    def echo() -> dict:
        return {"ok": True}

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True}

    return TestClient(app)


class TestSensitiveHeaderRedaction:
    """驗證 log_headers=True 時敏感 header 會被遮蔽、一般 header 保留。"""

    def _request_log_record(self, caplog: pytest.LogCaptureFixture) -> logging.LogRecord:
        records = [r for r in caplog.records if "-->" in r.getMessage()]
        assert records, "middleware 應記錄 request log"
        return records[0]

    def test_sensitive_headers_redacted_in_log_record(self, caplog: pytest.LogCaptureFixture) -> None:
        client = _build_app(log_headers=True)
        with caplog.at_level(logging.INFO, logger="starscope.middleware"):
            client.get(
                "/api/echo",
                headers={
                    "Authorization": "Bearer token123",
                    "X-Session-Secret": "secret-value",
                    "X-GitHub-Token": "ghp_xxx",
                    "Content-Type": "application/json",
                },
            )

        # extra={...} 塞進 LogRecord 的欄位是動態屬性，用 getattr 讓型別檢查通過
        headers: dict[str, str] = getattr(self._request_log_record(caplog), "headers")
        assert headers["authorization"] == "***"
        assert headers["x-session-secret"] == "***"
        assert headers["x-github-token"] == "***"
        # 一般 header 不遮蔽
        assert headers["content-type"] == "application/json"
        # 原始值絕不可出現在整包 log 資料中
        assert "secret-value" not in str(headers)

    def test_headers_absent_when_log_headers_disabled(self, caplog: pytest.LogCaptureFixture) -> None:
        """預設 log_headers=False：headers 完全不進 log（比遮蔽更強的保證）。"""
        client = _build_app(log_headers=False)
        with caplog.at_level(logging.INFO, logger="starscope.middleware"):
            client.get("/api/echo", headers={"X-Session-Secret": "secret-value"})

        record = self._request_log_record(caplog)
        assert not hasattr(record, "headers")
        assert "secret-value" not in caplog.text


class TestExcludePaths:
    def test_excluded_path_not_logged(self, caplog: pytest.LogCaptureFixture) -> None:
        client = _build_app()
        with caplog.at_level(logging.INFO, logger="starscope.middleware"):
            client.get("/api/health")

        assert not [r for r in caplog.records if "-->" in r.getMessage()]

    def test_response_logged_with_status(self, caplog: pytest.LogCaptureFixture) -> None:
        client = _build_app()
        with caplog.at_level(logging.INFO, logger="starscope.middleware"):
            client.get("/api/echo")

        responses = [r for r in caplog.records if "<--" in r.getMessage()]
        assert responses
        assert "200" in responses[0].getMessage()
