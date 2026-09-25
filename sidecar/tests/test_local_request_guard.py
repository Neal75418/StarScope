"""
LocalRequestGuardMiddleware 測試。

這一層與 session secret 無關：手動啟動的 sidecar（start-dev.sh、e2e）沒有 secret，
SessionAuthMiddleware 整個放行，瀏覽器裡的任何網頁都打得到 127.0.0.1:8008。
"""

import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from middleware.local_request_guard import LocalRequestGuardMiddleware

ALLOWED = ["tauri://localhost", "http://localhost:1420"]


def _build_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(CORSMiddleware, allow_origins=ALLOWED,
                       allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
    app.add_middleware(LocalRequestGuardMiddleware, allowed_origins=ALLOWED)

    @app.get("/api/repos")
    async def repos():
        return {"repos": []}

    @app.post("/api/repos/{repo_id}/unstar")
    async def unstar(repo_id: int):
        return {"id": repo_id}

    return app


@pytest.fixture
def guard_client():
    # 不能叫 client：會遮蔽 conftest 的主 app client，TestMountedOnMainApp 就測不到 main.app
    with TestClient(_build_app(), base_url="http://127.0.0.1:8008") as c:
        yield c


class TestHost:
    """DNS rebinding：攻擊者的網域解析到 127.0.0.1，請求的 Host 仍是攻擊者的網域。"""

    def test_rejects_foreign_host(self, guard_client):
        resp = guard_client.get("/api/repos", headers={"Host": "evil.example:8008"})
        assert resp.status_code == 403

    @pytest.mark.parametrize("host", ["127.0.0.1:8008", "localhost:8008",
                                      "127.0.0.1:8009", "localhost"])
    def test_accepts_loopback_host_on_any_port(self, guard_client, host):
        # e2e 的 sidecar 跑在 8009；寫死 8008 會讓 CI 的 e2e 全部 403
        resp = guard_client.get("/api/repos", headers={"Host": host})
        assert resp.status_code == 200

    def test_rejects_loopback_name_as_subdomain(self, guard_client):
        # 只比前綴會放行 localhost.evil.example
        resp = guard_client.get("/api/repos", headers={"Host": "localhost.evil.example"})
        assert resp.status_code == 403


class TestOrigin:
    """跨站請求：瀏覽器對跨站的非 GET 請求一定帶 Origin，no-cors 也一樣。"""

    def test_rejects_cross_site_post(self, guard_client):
        resp = guard_client.post("/api/repos/1/unstar", headers={"Origin": "https://evil.example"})
        assert resp.status_code == 403

    def test_rejects_null_origin(self, guard_client):
        # sandboxed iframe、data: URL 送出的 Origin 是字面上的 "null"
        resp = guard_client.post("/api/repos/1/unstar", headers={"Origin": "null"})
        assert resp.status_code == 403

    @pytest.mark.parametrize("origin", ALLOWED)
    def test_accepts_allowed_origin(self, guard_client, origin):
        resp = guard_client.post("/api/repos/1/unstar", headers={"Origin": origin})
        assert resp.status_code == 200

    def test_accepts_request_without_origin(self, guard_client):
        # curl、健康檢查、頁面導覽式的 GET 都不帶 Origin
        resp = guard_client.post("/api/repos/1/unstar")
        assert resp.status_code == 200

    def test_rejects_cross_site_preflight(self, guard_client):
        resp = guard_client.options("/api/repos/1/unstar", headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "POST",
        })
        assert resp.status_code == 403

    def test_allowed_preflight_still_gets_cors_headers(self, guard_client):
        resp = guard_client.options("/api/repos/1/unstar", headers={
            "Origin": "http://localhost:1420",
            "Access-Control-Request-Method": "POST",
        })
        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == "http://localhost:1420"


class _RecordingGitHub:
    can_write = True

    def __init__(self):
        self.calls: list[tuple[str, str, str]] = []

    async def unstar_repo(self, owner: str, name: str) -> None:
        self.calls.append(("unstar", owner, name))


class TestMountedOnMainApp:
    """守衛要真的掛在 main.app 上，而且在沒有 session secret 的開發模式下也要生效。"""

    @pytest.fixture
    def github(self, monkeypatch):
        # 一定要換掉：守衛失效時這個請求會一路走到 GitHub，而本機跑測試讀得到 Keychain 裡的真 token
        gh = _RecordingGitHub()
        monkeypatch.setattr("routers.repos.get_github_service", lambda: gh)
        return gh

    def test_cross_site_unstar_is_blocked_before_touching_data(
            self, client, test_db, mock_repo, github):
        # client 是 conftest 的主 app client，沒有設定 STARSCOPE_SESSION_SECRET
        resp = client.post(f"/api/repos/{mock_repo.id}/unstar",
                           headers={"Origin": "https://evil.example"})

        assert resp.status_code == 403
        assert github.calls == []
        test_db.refresh(mock_repo)
        assert mock_repo.unstarred_at is None

    def test_same_request_from_the_app_origin_still_works(
            self, client, test_db, mock_repo, github):
        # 對照組：證明上一條的 403 來自 Origin，而不是這個端點本來就打不通
        resp = client.post(f"/api/repos/{mock_repo.id}/unstar",
                           headers={"Origin": "http://localhost:1420"})

        assert resp.status_code == 200
        assert github.calls == [("unstar", mock_repo.owner, mock_repo.name)]

    def test_rejection_is_still_logged(self, client):
        # 守衛要掛在 LoggingMiddleware 內層：掛到外層的話，被擋的請求不會帶 X-Request-ID、
        # 也不進 access log（守衛自己的 warning 仍在，但跟 access log 對不起來）
        resp = client.get("/api/repos", headers={"Origin": "https://evil.example"})
        assert resp.status_code == 403
        assert "x-request-id" in resp.headers

    def test_foreign_host_is_blocked(self, client):
        resp = client.get("/api/repos", headers={"Host": "evil.example:8008"})
        assert resp.status_code == 403


def test_production_origins_cover_every_tauri_platform(monkeypatch):
    """守衛拒絕清單外的 Origin，漏掉一個平台＝那個平台的 app 每個請求都 403。

    Windows 的 Tauri 預設是 http://tauri.localhost（useHttpsScheme 預設 false），
    https 只在設定打開時才用。
    """
    import main

    monkeypatch.setattr(main, "ENV", "production")
    origins = set(main.get_allowed_origins())

    assert {"tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"} <= origins
    assert not any(o.startswith("http://localhost") for o in origins)
