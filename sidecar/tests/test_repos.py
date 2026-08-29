"""
Tests for repository endpoints.
"""

import asyncio
import json
from unittest.mock import patch, AsyncMock


MOCK_GITHUB_REPO_DATA = {
    "id": 10270250,
    "name": "react",
    "full_name": "facebook/react",
    "description": "A JavaScript library for building UIs",
    "default_branch": "main",
    "language": "JavaScript",
    "stargazers_count": 220000,
    "forks_count": 45000,
    "subscribers_count": 6000,
    "open_issues_count": 1200,
    "created_at": "2013-05-24T16:15:54Z",
}


def _mock_github_service(**repo_overrides):
    """Create a patched GitHub service returning the given repo data.

    Returns a tuple of (patch_context, mock_service) for use with ``with``.
    ``repo_overrides`` are merged into MOCK_GITHUB_REPO_DATA.
    """
    mock_service = AsyncMock()
    mock_service.get_repo.return_value = {**MOCK_GITHUB_REPO_DATA, **repo_overrides}
    return mock_service


class TestReposEndpoints:
    """Test cases for /api/repos endpoints."""

    def test_list_repos_empty(self, client):
        """Test listing repos when database is empty."""
        response = client.get("/api/repos")
        assert response.status_code == 200
        data = response.json()
        # 驗證統一的 API 響應格式
        assert data["success"] is True
        assert data["data"]["repos"] == []
        assert data["data"]["total"] == 0
        assert data["error"] is None

    def test_list_repos_with_data(self, client, mock_repo):
        """Test listing repos returns existing repos."""
        response = client.get("/api/repos")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["total"] == 1
        assert data["data"]["repos"][0]["full_name"] == "testowner/testrepo"

    def test_list_repos_pagination(self, client, mock_multiple_repos):
        """Test listing repos with pagination parameters."""
        response = client.get("/api/repos?page=1&per_page=2")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert len(data["data"]["repos"]) == 2
        assert data["data"]["total"] == 3
        assert data["data"]["page"] == 1
        assert data["data"]["per_page"] == 2
        assert data["data"]["total_pages"] == 2

    def test_list_repos_pagination_page_only_fails(self, client):
        """Test that providing page without per_page raises 400."""
        response = client.get("/api/repos?page=1")
        assert response.status_code == 400
        assert "Both" in response.json()["detail"]

    def test_list_repos_pagination_per_page_only_fails(self, client):
        """Test that providing per_page without page raises 400."""
        response = client.get("/api/repos?per_page=10")
        assert response.status_code == 400
        assert "Both" in response.json()["detail"]

    def test_add_repo_success(self, client):
        """Test adding a new repo with owner+name via mocked GitHub."""
        with patch("routers.repos.get_github_service") as mock_gh:
            mock_gh.return_value = _mock_github_service()

            response = client.post("/api/repos", json={
                "owner": "facebook",
                "name": "react"
            })

        assert response.status_code == 201
        data = response.json()
        assert data["success"] is True
        assert data["data"]["full_name"] == "facebook/react"
        assert data["data"]["language"] == "JavaScript"
        assert data["message"] == "Repository facebook/react added to watchlist"

    def test_add_repo_via_url(self, client):
        """Test adding a new repo via GitHub URL."""
        with patch("routers.repos.get_github_service") as mock_gh:
            mock_gh.return_value = _mock_github_service()

            response = client.post("/api/repos", json={
                "url": "https://github.com/facebook/react"
            })

        assert response.status_code == 201
        data = response.json()
        assert data["data"]["full_name"] == "facebook/react"

    def test_add_repo_duplicate(self, client, mock_repo):
        """Test adding a repo that already exists returns 400."""
        response = client.post("/api/repos", json={
            "owner": "testowner",
            "name": "testrepo"
        })
        assert response.status_code == 400
        assert "already in your watchlist" in response.json()["detail"]

    def test_add_repo_invalid_format(self, client):
        """Test adding repo with invalid format (only name, no owner)."""
        response = client.post("/api/repos", json={"name": "invalid"})
        assert response.status_code == 422  # Pydantic model_validator requires both

    def test_add_repo_missing_fields(self, client):
        """Test adding repo with missing required fields."""
        response = client.post("/api/repos", json={})
        assert response.status_code == 422  # Pydantic model_validator requires owner+name or url

    def test_get_repo_success(self, client, mock_repo):
        """Test getting a single repo by ID."""
        response = client.get(f"/api/repos/{mock_repo.id}")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["full_name"] == "testowner/testrepo"

    def test_delete_refuses_a_tracked_repo(self, client, mock_repo):
        """永久刪除只接受已封存的 repo。

        追蹤清單上的「移除」現在是取消追蹤（POST /unstar），會保留快照與訊號。
        永久刪除會 cascade 掉快照、訊號與警示規則且不可復原，所以只能從封存清單
        發動，不能是追蹤清單上的一次誤點。
        """
        response = client.delete(f"/api/repos/{mock_repo.id}")
        assert response.status_code == 400

    def test_delete_removes_an_archived_repo(self, client, test_db, mock_repo):
        from utils.time import utc_now

        mock_repo.unstarred_at = utc_now()
        test_db.commit()

        assert client.delete(f"/api/repos/{mock_repo.id}").status_code == 204
        assert client.get(f"/api/repos/{mock_repo.id}").status_code == 404

    def test_delete_nonexistent_repo(self, client):
        """Test deleting a repo that doesn't exist."""
        response = client.delete("/api/repos/99999")
        assert response.status_code == 404

    def test_fetch_repo_success(self, client, mock_repo):
        """Test manually fetching latest data for a repo."""
        with patch("routers.repos.get_github_service") as mock_gh:
            mock_gh.return_value = _mock_github_service(
                full_name="testowner/testrepo", name="testrepo"
            )

            response = client.post(f"/api/repos/{mock_repo.id}/fetch")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "refreshed" in data["message"].lower()

    def test_fetch_nonexistent_repo(self, client):
        """Test fetching data for a repo that doesn't exist."""
        response = client.post("/api/repos/99999/fetch")
        assert response.status_code == 404

    def test_fetch_all_repos_success(self, client, mock_repo):
        """Test batch refresh of all repos."""
        with patch("routers.repos.get_github_service") as mock_gh, \
             patch("routers.repos.fetch_repo_with_retry", new_callable=AsyncMock) as mock_retry:
            mock_service = AsyncMock()
            mock_gh.return_value = mock_service
            mock_retry.return_value = {
                **MOCK_GITHUB_REPO_DATA,
                "full_name": "testowner/testrepo",
                "name": "testrepo",
            }

            response = client.post("/api/repos/fetch-all")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "Refreshed 1" in data["message"]

    def test_fetch_all_repos_partial_failure(self, client, mock_multiple_repos):
        """Test batch refresh with some repos failing (GitHubNotFoundError)."""
        from services.github import GitHubNotFoundError

        call_count = 0

        async def mock_fetch(github, owner, name):
            nonlocal call_count
            call_count += 1
            if call_count == 2:
                raise GitHubNotFoundError(f"{owner}/{name}")
            return {
                **MOCK_GITHUB_REPO_DATA,
                "full_name": f"{owner}/{name}",
                "name": name,
            }

        with patch("routers.repos.get_github_service") as mock_gh, \
             patch("routers.repos.fetch_repo_with_retry", side_effect=mock_fetch):
            mock_gh.return_value = AsyncMock()

            response = client.post("/api/repos/fetch-all")

        assert response.status_code == 200
        data = response.json()
        assert "1 failed" in data["message"]

    def test_fetch_all_repos_api_error(self, client, mock_repo):
        """Test batch refresh with GitHubAPIError."""
        from services.github import GitHubAPIError

        with patch("routers.repos.get_github_service") as mock_gh, \
             patch("routers.repos.fetch_repo_with_retry", new_callable=AsyncMock) as mock_retry:
            mock_gh.return_value = AsyncMock()
            mock_retry.side_effect = GitHubAPIError("Rate limit exceeded")

            response = client.post("/api/repos/fetch-all")

        assert response.status_code == 200
        data = response.json()
        assert "1 failed" in data["message"]


    def test_fetch_all_returns_409_when_one_is_already_running(self, client, mock_repo):
        """撞到進行中的抓取要回 409，不是回 200。

        回 200 的話「我沒做」與「做完了」在呼叫端長得一模一樣——前端的 apiCall
        只取 data，message 會被丟掉——畫面因此會謊稱抓取已完成。實測：POST 14ms
        返回而真正的抓取 12 秒後才結束。
        """
        from services.scheduler import _fetch_all_lock

        async def _hold_and_call():
            async with _fetch_all_lock:
                return client.post("/api/repos/fetch-all")

        response = asyncio.run(_hold_and_call())

        assert response.status_code == 409
        assert "already in progress" in json.dumps(response.json()).lower()

    def test_fetch_all_lock_is_released_so_the_next_call_still_runs(self, client, mock_repo):
        """409 那條路不能把鎖漏掉——漏了的話之後每一次抓取都會被擋。"""
        from services.scheduler import _fetch_all_lock

        assert not _fetch_all_lock.locked()
        with patch("routers.repos.get_github_service") as mock_gh, \
             patch("routers.repos.fetch_repo_with_retry", new_callable=AsyncMock) as mock_retry:
            mock_gh.return_value = AsyncMock()
            mock_retry.return_value = {
                **MOCK_GITHUB_REPO_DATA,
                "full_name": "testowner/testrepo",
                "name": "testrepo",
            }
            response = client.post("/api/repos/fetch-all")

        assert response.status_code == 200
        assert not _fetch_all_lock.locked()


class TestStarsDelta1dOnTheWire:
    """stars_delta_1d 原本只在 service 層驗過（test_services_analyzer.py），沒有人
    驗過它真的活著走出 RepoWithSignals 這個 response_model——weekly summary 就是
    在這個位置漏過一次欄位（repos_compared），而且完全沒有錯誤訊息。掉了的話
    computeMovers 會永遠回傳一個 null 窗口，movers 面板會永遠卡在
    「Building history」，沒有任何地方會報錯。
    """

    def test_stars_delta_1d_survives_the_repos_endpoint(self, client, mock_repo, test_db):
        from datetime import timedelta
        from db.models import RepoSnapshot
        from services.analyzer import calculate_signals
        from utils.time import utc_today

        today = utc_today()
        test_db.add_all([
            RepoSnapshot(repo_id=mock_repo.id, stars=900, forks=0, watchers=0,
                         open_issues=0, snapshot_date=today - timedelta(days=1)),
            RepoSnapshot(repo_id=mock_repo.id, stars=1000, forks=0, watchers=0,
                         open_issues=0, snapshot_date=today),
        ])
        test_db.commit()
        calculate_signals(mock_repo.id, test_db)
        test_db.commit()

        response = client.get("/api/repos")
        repo_data = response.json()["data"]["repos"][0]

        assert repo_data["stars_delta_1d"] == 100.0, (
            "service 算出來的值要能原封不動送到線上；掉了的話這裡會看到 None 而不是報錯"
        )


class TestInputValidation:
    """Test input validation for repository endpoints."""

    def test_owner_name_too_long(self, client):
        """Test that overly long owner names are rejected."""
        response = client.post("/api/repos", json={
            "owner": "a" * 100,
            "name": "test"
        })
        assert response.status_code == 422  # Pydantic validation error

    def test_repo_name_too_long(self, client):
        """Test that overly long repo names are rejected."""
        response = client.post("/api/repos", json={
            "owner": "test",
            "name": "a" * 200
        })
        assert response.status_code == 422  # Pydantic validation error

    def test_invalid_owner_format(self, client):
        """Test that invalid owner format is rejected."""
        response = client.post("/api/repos", json={
            "owner": "invalid--owner",  # consecutive hyphens are invalid
            "name": "test"
        })
        assert response.status_code == 422  # Pydantic validation error

    def test_invalid_repo_name_format(self, client):
        """Test that invalid repo name format is rejected."""
        response = client.post("/api/repos", json={
            "owner": "valid",
            "name": "invalid repo name with spaces"
        })
        assert response.status_code == 422  # Pydantic validation error


class TestSyncStatusRespectsLockExpiry:
    def test_stale_lock_reads_not_running(self, client, test_db):
        """行程被殺時鎖會殘留。bool(非空) 會永遠顯示「同步中」把同步按鈕鎖住
        最長一小時——過期規則只在 star_sync 一處定義，狀態端點必須用同一套。"""
        from datetime import timedelta
        from services.settings import set_setting
        from db.models import AppSettingKey
        from utils.time import utc_now  # 生產寫入的是 naive UTC，fixture 必須同型

        stale = (utc_now() - timedelta(minutes=11)).isoformat()
        set_setting(AppSettingKey.STAR_SYNC_RUNNING, stale, test_db)

        body = client.get("/api/repos/sync/status").json()["data"]
        assert body["running"] is False

    def test_fresh_lock_reads_running(self, client, test_db):
        from services.settings import set_setting
        from db.models import AppSettingKey
        from utils.time import utc_now

        set_setting(AppSettingKey.STAR_SYNC_RUNNING, utc_now().isoformat(), test_db)

        body = client.get("/api/repos/sync/status").json()["data"]
        assert body["running"] is True
