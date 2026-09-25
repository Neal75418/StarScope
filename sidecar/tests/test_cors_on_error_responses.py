"""
錯誤回應也要帶 CORS header。

前端對 sidecar 是跨來源請求：回應沒有 Access-Control-Allow-Origin 時，瀏覽器不讓 fetch
讀到它，前端只拿到 TypeError，顯示成「Network error」，看起來跟 sidecar 掛掉一模一樣。
middleware 自己回的 403 與沒接住的例外造成的 500 都不經過 route，最容易漏掉 CORS。

一律打 main.app：middleware 的順序寫在 main.py，自己組的 app 測不到它。
"""

import os

import pytest

from db.database import get_db
from middleware.session_auth import SESSION_SECRET_HEADER

APP_ORIGIN = "http://localhost:1420"  # 非 production 環境的允許清單裡有它
ENDPOINT = "/api/settings/fetch-interval"


def _allow_origin(resp):
    return resp.headers.get("access-control-allow-origin")


class TestRejectedRequests:
    def test_guard_rejection_is_readable_by_the_app(self, client):
        # 允許的 Origin 配上非 loopback 的 Host：Guard 擋下，前端要讀得到 403
        resp = client.get(ENDPOINT, headers={"Origin": APP_ORIGIN, "Host": "evil.example"})

        assert resp.status_code == 403
        assert _allow_origin(resp) == APP_ORIGIN

    def test_session_secret_rejection_is_readable_by_the_app(self, client, monkeypatch):
        # SessionAuthMiddleware 在建 middleware stack 時讀 secret；清掉快取的 stack 讓它重建
        monkeypatch.setenv("STARSCOPE_SESSION_SECRET", "s3cret")
        client.app.middleware_stack = None
        try:
            rejected = client.get(ENDPOINT, headers={"Origin": APP_ORIGIN})
            accepted = client.get(ENDPOINT, headers={"Origin": APP_ORIGIN,
                                                     SESSION_SECRET_HEADER: "s3cret"})
        finally:
            monkeypatch.delenv("STARSCOPE_SESSION_SECRET")
            client.app.middleware_stack = None
        assert os.getenv("STARSCOPE_SESSION_SECRET") is None

        assert rejected.status_code == 403
        assert _allow_origin(rejected) == APP_ORIGIN
        # 對照組：證明上面的 403 來自 secret 驗證，不是這個端點本來就打不通
        assert accepted.status_code == 200

    def test_foreign_origin_still_gets_no_cors_header(self, client):
        # CORS 移到外層後也不能替別的網站開門
        resp = client.get(ENDPOINT, headers={"Origin": "https://evil.example"})

        assert resp.status_code == 403
        assert _allow_origin(resp) is None


class TestUnhandledError:
    @pytest.fixture
    def broken_endpoint(self, client):
        def boom():
            raise RuntimeError("database file is locked: /Users/me/.starscope/starscope.db")

        client.app.dependency_overrides[get_db] = boom

    def test_is_a_500_the_app_can_read(self, client, broken_endpoint):
        resp = client.get(ENDPOINT, headers={"Origin": APP_ORIGIN})

        assert resp.status_code == 500
        assert _allow_origin(resp) == APP_ORIGIN
        assert resp.json() == {"detail": "Internal server error"}
        # LoggingMiddleware 看到的是回應而不是例外：500 也進 access log、帶 request id
        assert "x-request-id" in resp.headers

    def test_is_logged_with_traceback(self, client, broken_endpoint, caplog):
        with caplog.at_level("ERROR", logger="starscope.middleware"):
            client.get(ENDPOINT, headers={"Origin": APP_ORIGIN})

        records = [r for r in caplog.records if r.exc_info and r.exc_info[0] is RuntimeError]
        assert records, "沒接住的例外要留下 traceback，否則 500 無從查起"


def test_preflight_from_the_app_still_passes(client):
    resp = client.options(ENDPOINT, headers={
        "Origin": APP_ORIGIN,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type,x-session-secret",
    })

    assert resp.status_code == 200
    assert _allow_origin(resp) == APP_ORIGIN
