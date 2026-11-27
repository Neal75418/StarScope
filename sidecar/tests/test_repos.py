"""
Tests for repository endpoints.
"""

import asyncio
import json
from unittest.mock import patch, AsyncMock

import httpx
import pytest

from middleware.rate_limit import limiter
from services.github import GitHubAPIError, GitHubNotFoundError, GitHubService
from services import scheduler
from services.scheduler import get_scheduler_health


@pytest.fixture(autouse=True)
def _fresh_rate_limits():
    """/repos/fetch-all 限流 5/minute：整檔累積的呼叫超過就被擋成 429，測的就不是那條測試要測的事。"""
    limiter.reset()


@pytest.fixture(autouse=True)
def _restore_scheduler_state():
    """fetch-all 走排程的實作，會寫模組層的健康狀態與連續失敗計數：不還原的話，測試順序一換就互相污染。"""
    with scheduler._health_lock:
        health = dict(scheduler._scheduler_health)
    with scheduler._failure_counts_lock:
        failures = dict(scheduler._repo_failure_counts)
    yield
    with scheduler._health_lock:
        scheduler._scheduler_health.clear()
        scheduler._scheduler_health.update(health)
    with scheduler._failure_counts_lock:
        scheduler._repo_failure_counts.clear()
        scheduler._repo_failure_counts.update(failures)


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
        # 前端靠這個 code 說「已經在追蹤清單」，而不是「沒有加入」
        assert response.json()["code"] == "ALREADY_TRACKED"

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
        with patch("services.scheduler.fetch_repo_data", new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = _github_payload("testowner", "testrepo")

            response = client.post("/api/repos/fetch-all")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "Refreshed 1" in data["message"]

    def test_fetch_all_repos_partial_failure(self, client, mock_multiple_repos):
        """Test batch refresh with some repos failing (GitHubNotFoundError)."""
        # 抓取是併發的，依名字決定哪個失敗，不依呼叫順序
        async def mock_fetch(owner, name):
            if name == "vue":
                raise GitHubNotFoundError(f"{owner}/{name}", 404)
            return _github_payload(owner, name)

        with patch("services.scheduler.fetch_repo_data", side_effect=mock_fetch):
            response = client.post("/api/repos/fetch-all")

        assert response.status_code == 200
        data = response.json()
        assert "1 failed" in data["message"]

    def test_fetch_all_repos_api_error(self, client, mock_repo):
        """Test batch refresh with GitHubAPIError."""
        with patch("services.scheduler.fetch_repo_data", new_callable=AsyncMock) as mock_fetch:
            mock_fetch.side_effect = GitHubAPIError("GitHub API forbidden (remaining: 12)", 403)

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
        from services.scheduler import fetch_all_lock

        async def _hold_and_call():
            async with fetch_all_lock:
                return client.post("/api/repos/fetch-all")

        response = asyncio.run(_hold_and_call())

        assert response.status_code == 409
        assert "already in progress" in json.dumps(response.json()).lower()

    def test_fetch_all_lock_is_released_so_the_next_call_still_runs(self, client, mock_repo):
        """409 那條路不能把鎖漏掉——漏了的話之後每一次抓取都會被擋。"""
        from services.scheduler import fetch_all_lock

        assert not fetch_all_lock.locked()
        with patch("services.scheduler.fetch_repo_data", new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = _github_payload("testowner", "testrepo")
            response = client.post("/api/repos/fetch-all")

        assert response.status_code == 200
        assert not fetch_all_lock.locked()


def _github_payload(owner: str, name: str) -> dict:
    return {**MOCK_GITHUB_REPO_DATA, "full_name": f"{owner}/{name}", "name": name}


@pytest.fixture
def github_answering():
    """回應由 handler 決定的 GitHubService：請求照樣走過 _check_github_errors，只是不連網路。"""
    made: list[GitHubService] = []

    def make(handler) -> GitHubService:
        service = GitHubService(token=None)
        service._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        made.append(service)
        return service

    yield make
    for service in made:
        asyncio.run(service.aclose())


class TestFetchAllSurvivesGitHubFailures:
    """手動「全部重新整理」與排程走同一份實作：一個 repo 失敗只算它失敗，其他照常更新。"""

    def test_a_github_5xx_counts_as_failed_and_the_rest_still_refresh(self, client, mock_multiple_repos):
        async def fetch(owner, name):
            if name == "vue":
                raise GitHubAPIError("GitHub API error (HTTP 502)", 502)
            return _github_payload(owner, name)

        with patch("services.scheduler.fetch_repo_data", side_effect=fetch):
            response = client.post("/api/repos/fetch-all")

        assert response.status_code == 200
        data = response.json()["data"]
        assert (data["success_count"], data["failed_count"]) == (2, 1)

    def test_github_unreachable_counts_as_failed_instead_of_aborting(self, client, mock_multiple_repos):
        async def fetch(owner, name):
            if name == "vue":
                raise httpx.ConnectError("connection refused")
            return _github_payload(owner, name)

        with patch("services.scheduler.fetch_repo_data", side_effect=fetch):
            response = client.post("/api/repos/fetch-all")

        assert response.status_code == 200
        data = response.json()["data"]
        assert (data["success_count"], data["failed_count"]) == (2, 1)

    def test_a_rejected_token_is_asked_once_per_repo(self, client, mock_multiple_repos):
        """token 失效（401）不會自己好：重試只會讓每個 repo 多等一分鐘，期間抓取鎖被佔著、排程被跳過。"""
        with patch("services.scheduler.fetch_repo_data", new_callable=AsyncMock) as mock_fetch:
            mock_fetch.side_effect = GitHubAPIError("GitHub API authentication failed - check token", 401)
            response = client.post("/api/repos/fetch-all")

        assert response.status_code == 200
        assert mock_fetch.await_count == 3
        assert response.json()["data"]["failed_count"] == 3

    def test_records_the_fetch_for_the_freshness_label(self, client, mock_repo):
        """儀表板的抓取時間讀 last_fetch_success：手動重新整理成功後不能還停在上一輪排程的時間。"""
        with scheduler._health_lock:
            scheduler._scheduler_health["last_fetch_success"] = None
        with patch("services.scheduler.fetch_repo_data", new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = _github_payload("testowner", "testrepo")
            client.post("/api/repos/fetch-all")

        assert get_scheduler_health()["last_fetch_success"] is not None

    def test_a_failed_round_is_an_error_not_a_refresh(self, client, mock_repo):
        """整輪層級的資料庫錯誤（不是個別 repo 的失敗）：回 200 的話畫面會謊稱已更新。"""
        failed_round = {"success": 0, "errors": 0, "skipped": 0, "job_error": "database is locked"}
        with patch("services.scheduler.fetch_all_repos_holding_lock", new_callable=AsyncMock) as run:
            run.return_value = failed_round
            response = client.post("/api/repos/fetch-all")

        assert response.status_code == 500


class TestSingleFetchReportsGitHubFailuresAsBadGateway:
    """上游（GitHub）失敗要回 502，前端才分得出是 GitHub 的問題；沒有對應 handler 時一律變成籠統的 500。"""

    def test_github_5xx_is_502(self, client, mock_repo, github_answering):
        service = github_answering(lambda request: httpx.Response(502, request=request))
        with patch("routers.repos.get_github_service", return_value=service):
            response = client.post(f"/api/repos/{mock_repo.id}/fetch")

        assert response.status_code == 502
        # 這段文字會直接顯示在畫面上：handler 已經加了「GitHub API error:」，例外訊息不必再說一次
        assert response.json()["detail"].count("GitHub API error") == 1

    def test_github_unreachable_is_502(self, client, mock_repo, github_answering):
        def refuse(request):
            raise httpx.ConnectError("connection refused", request=request)

        service = github_answering(refuse)
        with patch("routers.repos.get_github_service", return_value=service):
            response = client.post(f"/api/repos/{mock_repo.id}/fetch")

        assert response.status_code == 502


class TestGitHubFailuresSayWhatKind:
    """畫面要依原因給不同的說法：授權失效等再久也不會好，不能和暫時性的失敗用同一句「稍後再試」。"""

    @staticmethod
    def _fetch(client, mock_repo, github_answering, answer):
        service = github_answering(answer)
        with patch("routers.repos.get_github_service", return_value=service):
            return client.post(f"/api/repos/{mock_repo.id}/fetch")

    def test_rejected_token_is_marked_as_an_auth_failure(self, client, mock_repo, github_answering):
        response = self._fetch(
            client, mock_repo, github_answering, lambda request: httpx.Response(401, request=request))

        assert response.status_code == 502
        assert response.json()["code"] == "GITHUB_AUTH_FAILED"

    def test_forbidden_without_rate_limit_headers_is_marked_as_forbidden(
            self, client, mock_repo, github_answering):
        response = self._fetch(
            client, mock_repo, github_answering, lambda request: httpx.Response(403, request=request))

        assert response.status_code == 502
        assert response.json()["code"] == "GITHUB_FORBIDDEN"

    def test_a_github_outage_carries_no_code(self, client, mock_repo, github_answering):
        response = self._fetch(
            client, mock_repo, github_answering, lambda request: httpx.Response(503, request=request))

        assert response.status_code == 502
        assert "code" not in response.json()

    def test_a_missing_repository_is_marked_as_gone_from_github(
            self, client, mock_repo, github_answering):
        """本機找不到（get_repo_or_404）也是 404，但不帶這個 code：前端靠它分辨是哪一邊找不到。"""
        response = self._fetch(
            client, mock_repo, github_answering, lambda request: httpx.Response(404, request=request))

        assert response.status_code == 404
        assert response.json()["code"] == "GITHUB_NOT_FOUND"


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


class TestSyncStatusLastSnapshotAt:
    def test_reports_when_tracked_data_was_last_written(self, client, test_db, mock_repo):
        """背景抓取（排程、launchd 收集器）不會通知前端：前端靠這個時間變了沒，重讀追蹤清單與儀表板。
        從資料庫取，收集器那個行程的抓取也看得到。"""
        from datetime import datetime, timedelta
        from db.models import RepoSnapshot
        from utils.time import utc_today

        body = client.get("/api/repos/sync/status").json()["data"]
        assert body["last_snapshot_at"] is None

        # 今天那筆寫得較早，回填的舊日期那筆寫得最晚：要的是最晚寫入的時間，不是最新日期那筆、也不是最早寫入的
        test_db.add_all([
            RepoSnapshot(
                repo_id=mock_repo.id, stars=10, forks=0, watchers=0, open_issues=0,
                snapshot_date=utc_today(), fetched_at=datetime(2026, 11, 26, 1, 0, 0),
            ),
            RepoSnapshot(
                repo_id=mock_repo.id, stars=5, forks=0, watchers=0, open_issues=0,
                snapshot_date=utc_today() - timedelta(days=30), fetched_at=datetime(2026, 11, 26, 3, 4, 5),
            ),
        ])
        test_db.commit()

        body = client.get("/api/repos/sync/status").json()["data"]
        # 帶時區：naive UTC 被 JS 當本地時間解析
        assert body["last_snapshot_at"] == "2026-11-26T03:04:05+00:00"


class TestAddRepoMatchesTheExistingRowWhateverTheSpelling:
    """GitHub 的名稱不分大小寫、改名後舊名會導向：加入時用使用者輸入的字串精確比對 full_name 的話，
    大小寫不同或用舊名都會往下建一列，撞 full_name 唯一鍵回 500，或在本機名稱還是舊的時候多出一列同一個 repo。
    mock_repo 是 testowner/testrepo、github_id 12345"""

    @staticmethod
    def _github(full_name: str = "testowner/testrepo"):
        owner, name = full_name.split("/")
        service = _mock_github_service(id=12345, full_name=full_name, name=name, owner={"login": owner})
        service.can_write = True
        return service

    @staticmethod
    def _count(test_db) -> int:
        from db.models import Repo
        from db.soft_delete import include_archived

        count: int = include_archived(test_db.query(Repo)).count()
        return count

    @staticmethod
    def _archive(test_db, repo) -> None:
        from utils.time import utc_now

        repo.unstarred_at = utc_now()
        test_db.commit()

    def test_different_case_of_a_tracked_repo_is_already_tracked(self, client, test_db, mock_repo):
        github = self._github()
        with patch("routers.repos.get_github_service", return_value=github):
            response = client.post("/api/repos", json={"owner": "TestOwner", "name": "TestRepo"})

        assert response.status_code == 400
        assert response.json()["code"] == "ALREADY_TRACKED"
        assert self._count(test_db) == 1
        # 大小寫不同在打 GitHub 之前就認得出來
        github.star_repo.assert_not_called()
        github.get_repo.assert_not_called()

    def test_old_name_of_a_tracked_repo_is_already_tracked(self, client, test_db, mock_repo):
        github = self._github()
        with patch("routers.repos.get_github_service", return_value=github):
            response = client.post("/api/repos", json={"owner": "oldowner", "name": "testrepo"})

        assert response.status_code == 400
        assert response.json()["code"] == "ALREADY_TRACKED"
        assert self._count(test_db) == 1
        # 本來就在追蹤：不寫 GitHub
        github.star_repo.assert_not_called()

    def test_different_case_of_an_archived_repo_restores_that_row(self, client, test_db, mock_repo):
        self._archive(test_db, mock_repo)
        with patch("routers.repos.get_github_service", return_value=self._github()):
            response = client.post("/api/repos", json={"owner": "TestOwner", "name": "TestRepo"})

        assert response.status_code == 201
        assert "restored to" in response.json()["message"]
        assert response.json()["data"]["id"] == mock_repo.id
        assert self._count(test_db) == 1

    def test_old_name_of_an_archived_repo_restores_that_row(self, client, test_db, mock_repo):
        self._archive(test_db, mock_repo)
        github = self._github()
        with patch("routers.repos.get_github_service", return_value=github):
            response = client.post("/api/repos", json={"owner": "oldowner", "name": "testrepo"})

        # star 用 GitHub 回的正式名稱，不靠舊名的導向
        github.star_repo.assert_awaited_once_with("testowner", "testrepo")

        assert response.status_code == 201
        assert "restored to" in response.json()["message"]
        assert response.json()["data"]["id"] == mock_repo.id
        assert self._count(test_db) == 1

    def test_new_name_finds_the_row_still_under_the_old_name(self, client, test_db, mock_repo):
        """本機那一列還沒抓到改名（名稱是舊的），用新名加入：靠 github_id 認出同一個 repo，不再多一列"""
        with patch("routers.repos.get_github_service", return_value=self._github("newowner/testrepo")):
            response = client.post("/api/repos", json={"owner": "newowner", "name": "testrepo"})

        assert response.status_code == 400
        assert response.json()["code"] == "ALREADY_TRACKED"
        assert self._count(test_db) == 1

    def test_the_row_with_the_same_github_id_wins_over_a_name_match(self, client, test_db, mock_repo):
        """名稱相符的列可能是另一個 repo（它的舊名被佔走）：先認 github_id 相符的那一列。
        mock_repo（testowner/testrepo、id 12345）已封存；追蹤中的另一列是 GitHub 上的 id 777"""
        from db.models import Repo

        self._archive(test_db, mock_repo)
        other = Repo(owner="testowner", name="renamed", full_name="testowner/renamed",
                     url="https://github.com/testowner/renamed", github_id=777)
        test_db.add(other)
        test_db.commit()
        github = _mock_github_service(id=777, full_name="testowner/testrepo", name="testrepo",
                                      owner={"login": "testowner"})
        github.can_write = True

        with patch("routers.repos.get_github_service", return_value=github):
            response = client.post("/api/repos", json={"owner": "testowner", "name": "alias"})

        assert response.status_code == 400
        assert response.json()["code"] == "ALREADY_TRACKED"
        test_db.refresh(mock_repo)
        assert mock_repo.unstarred_at is not None  # 另一個 repo 的封存列沒被復原
        github.star_repo.assert_not_called()

    def test_a_tracked_duplicate_wins_over_an_archived_one(self, client, test_db, mock_repo):
        """舊 bug 留下的重複列（同一個 github_id，一列封存、一列追蹤中）：認追蹤中的那列，不去復原封存的"""
        from db.models import Repo

        self._archive(test_db, mock_repo)
        test_db.add(Repo(owner="testowner", name="new", full_name="testowner/new",
                         url="https://github.com/testowner/new", github_id=12345))
        test_db.commit()

        with patch("routers.repos.get_github_service", return_value=self._github("testowner/new")):
            response = client.post("/api/repos", json={"owner": "testowner", "name": "alias"})

        assert response.status_code == 400
        assert response.json()["code"] == "ALREADY_TRACKED"
        test_db.refresh(mock_repo)
        assert mock_repo.unstarred_at is not None

    def test_an_archived_row_with_the_same_github_id_wins_over_a_tracked_name_match(self, client, test_db, mock_repo):
        """id 相符的列已封存、名稱相符的列在追蹤中但是另一個 repo（它的名稱被 id 777 拿走了）：要加的是 777，
        復原那一列，不是說「已在追蹤」。mock_repo（id 12345）是名稱相符的那個"""
        from db.models import Repo
        from utils.time import utc_now

        archived = Repo(owner="testowner", name="renamed", full_name="testowner/renamed",
                        url="https://github.com/testowner/renamed", github_id=777, unstarred_at=utc_now())
        test_db.add(archived)
        test_db.commit()
        github = _mock_github_service(id=777, full_name="testowner/testrepo", name="testrepo",
                                      owner={"login": "testowner"})
        github.can_write = True

        with patch("routers.repos.get_github_service", return_value=github):
            response = client.post("/api/repos", json={"owner": "testowner", "name": "alias"})

        assert response.status_code == 201
        assert response.json()["data"]["id"] == archived.id
        assert self._count(test_db) == 2
