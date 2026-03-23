"""
SessionAuthMiddleware 單元測試。
驗證 per-session secret 驗證邏輯。
"""

import os
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from middleware.session_auth import SessionAuthMiddleware, SESSION_SECRET_HEADER

TEST_SECRET = "test-secret-123"


def _build_app() -> FastAPI:
    """建立帶有 SessionAuthMiddleware 的測試 app（middleware 在 ASGI 啟動時初始化）。"""
    app = FastAPI()
    app.add_middleware(SessionAuthMiddleware)

    @app.get("/api/health")
    async def health():
        return {"status": "ok"}

    @app.get("/")
    async def root():
        return {"message": "root"}

    @app.get("/api/repos")
    async def repos():
        return {"repos": []}

    @app.post("/api/repos")
    async def add_repo():
        return {"id": 1}

    return app


class TestSessionAuthEnabled:
    """secret 已設定時的驗證行為。"""

    @pytest.fixture
    def client(self):
        # patch.dict 必須包住 TestClient，因為 middleware __init__ 在 ASGI 啟動時執行
        with patch.dict(os.environ, {"STARSCOPE_SESSION_SECRET": TEST_SECRET}):
            app = _build_app()
            with TestClient(app) as c:
                yield c

    def test_rejects_request_without_header(self, client):
        resp = client.get("/api/repos")
        assert resp.status_code == 403
        assert "invalid session secret" in resp.json()["detail"].lower()

    def test_rejects_request_with_wrong_secret(self, client):
        resp = client.get("/api/repos", headers={SESSION_SECRET_HEADER: "wrong"})
        assert resp.status_code == 403

    def test_accepts_request_with_correct_secret(self, client):
        resp = client.get("/api/repos", headers={SESSION_SECRET_HEADER: TEST_SECRET})
        assert resp.status_code == 200
        assert resp.json() == {"repos": []}

    def test_accepts_post_with_correct_secret(self, client):
        resp = client.post("/api/repos", headers={SESSION_SECRET_HEADER: TEST_SECRET})
        assert resp.status_code == 200

    def test_exempt_health_endpoint(self, client):
        resp = client.get("/api/health")
        assert resp.status_code == 200

    def test_exempt_root_endpoint(self, client):
        resp = client.get("/")
        assert resp.status_code == 200


class TestSessionAuthDisabled:
    """secret 未設定時（開發模式）跳過驗證。"""

    @pytest.fixture
    def client(self):
        # 確保 env var 不存在
        env = os.environ.copy()
        env.pop("STARSCOPE_SESSION_SECRET", None)
        with patch.dict(os.environ, env, clear=True):
            app = _build_app()
            with TestClient(app) as c:
                yield c

    def test_allows_request_without_header(self, client):
        resp = client.get("/api/repos")
        assert resp.status_code == 200

    def test_allows_request_with_any_header(self, client):
        resp = client.get("/api/repos", headers={SESSION_SECRET_HEADER: "anything"})
        assert resp.status_code == 200
