"""LoggingMiddleware 測試：透過真實 ASGI 請求驗證行為（不直接戳內部清單）。"""

import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from middleware.logging import LoggingMiddleware


def _build_app(**middleware_kwargs) -> TestClient:
    app = FastAPI()
    # add_middleware 的 ParamSpec 簽名 PyCharm 不支援，會誤報型別
    # noinspection PyTypeChecker
    app.add_middleware(LoggingMiddleware, **middleware_kwargs)

    @app.get("/api/echo")
    def echo() -> dict:
        return {"ok": True}

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True}

    @app.get("/api/boom")
    def boom() -> dict:
        raise RuntimeError("handler failed")

    return TestClient(app, raise_server_exceptions=False)


class TestRequestSecretsStayOutOfTheLog:
    """middleware 的 log 記方法、路徑、狀態與耗時，錯誤 log 另帶例外訊息與 traceback；
    headers 與 query 可能帶祕密，不放進訊息，也不掛在 LogRecord 上。"""

    @pytest.mark.parametrize("path", ["/api/echo", "/api/boom"])
    def test_headers_and_query_never_reach_the_log(self, caplog: pytest.LogCaptureFixture, path: str) -> None:
        """正常回應與 handler 丟例外兩條路徑都看（後者走 middleware 的錯誤 log）。"""
        client = _build_app()
        with caplog.at_level(logging.DEBUG):
            client.get(
                f"{path}?token=query-secret",
                headers={"Authorization": "Bearer header-secret", "X-Session-Secret": "session-secret"},
            )

        # TestClient 底下的 HTTP 用戶端會把它送出的網址記下來：那是測試這一端的 log，不是伺服器的
        server_records = [r for r in caplog.records if r.name.split(".")[0] not in {"httpx", "httpx2", "httpcore"}]
        assert [r for r in server_records if "-->" in r.getMessage()], "middleware 應記錄 request log"
        assert [r for r in server_records if "<--" in r.getMessage()], "middleware 應記錄 response 或錯誤 log"
        for record in server_records:
            # 訊息之外，extra 掛上去的動態屬性也會被結構化的 handler 送出去：整個 __dict__ 一起看
            everything = record.getMessage() + repr(vars(record))
            for secret in ("query-secret", "header-secret", "session-secret"):
                assert secret not in everything


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
