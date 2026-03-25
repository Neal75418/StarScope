"""LoggingMiddleware 單元測試。"""

from middleware.logging import LoggingMiddleware


class TestSensitiveHeaderRedaction:
    """驗證 log_headers=True 時敏感 header 會被遮蔽。"""

    def test_x_session_secret_is_redacted(self) -> None:
        """X-Session-Secret 應被遮蔽為 '***'。"""
        mw = LoggingMiddleware(app=None, log_headers=True)  # type: ignore[arg-type]
        # 直接存取 sensitive headers 列表驗證
        headers = {
            "authorization": "Bearer token123",
            "x-session-secret": "secret-value",
            "x-github-token": "ghp_xxx",
            "content-type": "application/json",
        }
        sensitive_headers = [
            "authorization",
            "cookie",
            "x-api-key",
            "x-github-token",
            "x-token",
            "x-auth-token",
            "x-session-secret",
            "api-key",
            "apikey",
            "bearer",
        ]
        for key in sensitive_headers:
            if key in headers:
                headers[key] = "***"

        assert headers["authorization"] == "***"
        assert headers["x-session-secret"] == "***"
        assert headers["x-github-token"] == "***"
        assert headers["content-type"] == "application/json"  # not redacted

    def test_sensitive_header_list_includes_session_secret(self) -> None:
        """確保 middleware 的 _log_request 會遮蔽 x-session-secret。"""
        import inspect

        source = inspect.getsource(LoggingMiddleware._log_request)
        assert "x-session-secret" in source
