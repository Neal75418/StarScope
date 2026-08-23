"""
Tests for GitHub service.
"""

import os
from contextlib import contextmanager

import pytest
import httpx
from unittest.mock import patch, MagicMock, AsyncMock

from services.github import (
    GitHubService,
    GitHubAPIError,
    GitHubNotFoundError,
    GitHubRateLimitError,
    build_github_headers,
    handle_github_response,
    fetch_repo_data,
    get_github_service,
    reset_github_service,
)


def _make_response(status_code: int = 200, json_data=None, headers=None):
    """Build a MagicMock that mimics an httpx.Response."""
    resp = MagicMock()
    resp.status_code = status_code
    if json_data is not None:
        resp.json.return_value = json_data
    if headers is not None:
        resp.headers = headers
    return resp


@contextmanager
def _mock_http_client(response):
    """Patch httpx.AsyncClient so that .get() returns *response*."""
    with patch("httpx.AsyncClient") as mock_cls:
        mock_client = AsyncMock()
        mock_client.get.return_value = response
        mock_client.is_closed = False
        mock_cls.return_value = mock_client
        yield mock_client


class TestBuildGitHubHeaders:
    """Tests for build_github_headers function."""

    def test_headers_without_token(self):
        """Test headers without authentication token."""
        headers = build_github_headers()

        assert "Accept" in headers
        assert headers["Accept"] == "application/vnd.github+json"
        assert "X-GitHub-Api-Version" in headers
        assert "Authorization" not in headers

    def test_headers_with_token(self):
        """Test headers with authentication token."""
        headers = build_github_headers(token="test-token")

        assert headers["Authorization"] == "Bearer test-token"
        assert "Accept" in headers


class TestHandleGitHubResponse:
    """Tests for handle_github_response function."""

    def test_handles_successful_response(self):
        """Test handles 200 response correctly."""
        result = handle_github_response(_make_response(200, {"stargazers_count": 1000}))
        assert result == {"stargazers_count": 1000}

    def test_handles_404_with_raise(self):
        """Test raises GitHubNotFoundError on 404."""
        with pytest.raises(GitHubNotFoundError) as exc_info:
            handle_github_response(_make_response(404), raise_on_error=True, context="owner/repo")

        assert exc_info.value.status_code == 404
        assert "owner/repo" in str(exc_info.value)

    def test_handles_404_without_raise(self):
        """Test returns None on 404 when raise_on_error=False."""
        result = handle_github_response(_make_response(404), raise_on_error=False)
        assert result is None

    def test_handles_403_rate_limit(self):
        """Test raises GitHubRateLimitError on 403."""
        resp = _make_response(403, headers={"X-RateLimit-Remaining": "0"})
        with pytest.raises(GitHubRateLimitError) as exc_info:
            handle_github_response(resp, raise_on_error=True)

        assert exc_info.value.status_code == 403

    def test_handles_429_as_rate_limit(self):
        """429（primary/secondary 皆可能）必須拋 GitHubRateLimitError。

        漏掉這個分支時 429 會落到 raise_for_status() 變成 HTTPStatusError，
        呼叫端所有「配額耗盡就停手」的守衛都會失效（feed fan-out 會繼續打完）。
        """
        resp = _make_response(429, headers={"X-RateLimit-Reset": "1700000000"})
        with pytest.raises(GitHubRateLimitError) as exc_info:
            handle_github_response(resp, raise_on_error=True)
        assert exc_info.value.status_code == 429
        assert exc_info.value.reset_at == 1700000000

    def test_429_retry_after_converted_to_reset_at(self):
        """次要限制常只給 Retry-After 秒數：換算成絕對時間才算得出回給前端的值。"""
        import time as _time

        resp = _make_response(429, headers={"Retry-After": "60"})
        with pytest.raises(GitHubRateLimitError) as exc_info:
            handle_github_response(resp, raise_on_error=True)
        assert exc_info.value.reset_at is not None
        assert 55 <= exc_info.value.reset_at - int(_time.time()) <= 65

    def test_handles_429_without_raise(self):
        resp = _make_response(429, headers={})
        assert handle_github_response(resp, raise_on_error=False) is None

    def test_handles_403_without_raise(self):
        """Test returns None on 403 when raise_on_error=False."""
        resp = _make_response(403, headers={"X-RateLimit-Remaining": "0"})
        result = handle_github_response(resp, raise_on_error=False, context="test")
        assert result is None

    def test_handles_401_unauthorized(self):
        """Test raises GitHubAPIError on 401."""
        with pytest.raises(GitHubAPIError) as exc_info:
            handle_github_response(_make_response(401), raise_on_error=True)

        assert exc_info.value.status_code == 401
        assert "authentication" in str(exc_info.value).lower()

    def test_handles_401_without_raise(self):
        """Test returns None on 401 when raise_on_error=False."""
        result = handle_github_response(_make_response(401), raise_on_error=False)
        assert result is None


class TestFetchRepoData:
    """Tests for fetch_repo_data function."""

    @pytest.mark.asyncio
    async def test_fetch_repo_data_success(self):
        """Test successful repo data fetch."""
        reset_github_service()

        mock_response = {"stargazers_count": 1000, "forks_count": 100}

        with patch.object(GitHubService, 'get_repo', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_response

            result = await fetch_repo_data("owner", "repo")

            assert result == mock_response

        reset_github_service()

    @pytest.mark.asyncio
    @pytest.mark.parametrize("exception", [
        GitHubNotFoundError("Not found", 404),
        GitHubRateLimitError("Rate limit", 403),
        GitHubAPIError("API Error", 500),
        httpx.TimeoutException("Timeout"),
        httpx.RequestError("Network error"),
    ], ids=["not_found", "rate_limit", "api_error", "timeout", "network_error"])
    async def test_fetch_repo_data_returns_none_on_error(self, exception):
        """Test returns None when get_repo raises any handled exception."""
        reset_github_service()

        with patch.object(GitHubService, 'get_repo', new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = exception
            result = await fetch_repo_data("owner", "repo")
            assert result is None

        reset_github_service()


class TestGitHubServiceGetRepo:
    """Tests for GitHubService.get_repo method."""

    @pytest.mark.asyncio
    async def test_get_repo_success(self):
        """Test successful repo fetch."""
        service = GitHubService(token="test-token")

        with _mock_http_client(_make_response(200, {"stargazers_count": 1000})) as mock_client:
            result = await service.get_repo("owner", "repo")

            assert result == {"stargazers_count": 1000}
            mock_client.get.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_repo_stargazers_count(self):
        """Test get_repo_stargazers_count convenience method."""
        service = GitHubService()

        with patch.object(service, 'get_repo', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = {"stargazers_count": 5000}

            result = await service.get_repo_stargazers_count("owner", "repo")

            assert result == 5000


class TestGitHubServiceTokenPriority:
    """Tests for GitHub service token priority."""

    def test_uses_database_token_first(self):
        """Test prefers database token over environment."""
        reset_github_service()

        with patch('services.settings.get_setting') as mock_get_setting:
            mock_get_setting.return_value = "db-token"

            with patch.dict(os.environ, {"GITHUB_TOKEN": "env-token"}, clear=True):
                service = get_github_service()
                assert service.token == "db-token"

        reset_github_service()

    def test_falls_back_to_env_token(self):
        """Test falls back to environment when no database token."""
        reset_github_service()

        with patch('services.settings.get_setting') as mock_get_setting:
            mock_get_setting.return_value = None

            with patch.dict(os.environ, {"GITHUB_TOKEN": "env-token"}, clear=True):
                service = get_github_service()
                assert service.token == "env-token"

        reset_github_service()

    def test_handles_database_exception(self):
        """Test handles exception when reading from database."""
        reset_github_service()

        with patch('services.settings.get_setting') as mock_get_setting:
            mock_get_setting.side_effect = Exception("DB Error")

            with patch.dict(os.environ, {"GITHUB_TOKEN": "env-token"}, clear=True):
                service = get_github_service()
                assert service.token == "env-token"

        reset_github_service()


class TestGitHubService:
    """Test cases for GitHub service."""

    def test_get_github_service_reads_token_from_env(self):
        """Test that get_github_service reads token from environment."""
        from services.github import get_github_service, reset_github_service

        # Reset to ensure clean state
        reset_github_service()

        with patch('services.settings.get_setting', return_value=None):
            with patch.dict(os.environ, {"GITHUB_TOKEN": "test-token-123"}, clear=True):
                service = get_github_service()
                assert service.token == "test-token-123"
                assert "Authorization" in service.headers
                assert service.headers["Authorization"] == "Bearer test-token-123"

        # Clean up
        reset_github_service()

    def test_get_github_service_no_token(self):
        """Test that service works without token (with rate limits)."""
        from services.github import get_github_service, reset_github_service

        # Reset to ensure clean state
        reset_github_service()

        with patch('services.settings.get_setting', return_value=None):
            with patch.dict(os.environ, {}, clear=True):
                service = get_github_service()
                assert service.token is None
                assert "Authorization" not in service.headers

        # Clean up
        reset_github_service()

    def test_get_github_service_singleton(self):
        """Test that get_github_service returns same instance."""
        from services.github import get_github_service, reset_github_service

        # Reset to ensure clean state
        reset_github_service()

        # patch 掉 token 讀取：不得碰真實 Keychain / 真實 DB 檔
        with patch('services.settings.get_setting', return_value=None), \
             patch.dict(os.environ, {}, clear=True):
            service1 = get_github_service()
            service2 = get_github_service()
            assert service1 is service2

        # Clean up
        reset_github_service()

    def test_reset_github_service(self):
        """Test that reset_github_service creates new instance."""
        from services.github import get_github_service, reset_github_service

        with patch('services.settings.get_setting', return_value=None), \
             patch.dict(os.environ, {}, clear=True):
            service1 = get_github_service()
            reset_github_service()
            service2 = get_github_service()

            assert service1 is not service2

        # Clean up
        reset_github_service()

    def test_github_service_headers(self):
        """Test that GitHub service has correct default headers."""
        from services.github import GitHubService

        service = GitHubService()
        assert "Accept" in service.headers
        assert service.headers["Accept"] == "application/vnd.github+json"
        assert "X-GitHub-Api-Version" in service.headers


class TestGitHubServiceSearchRepos:
    """Tests for GitHubService.search_repos method."""

    @pytest.mark.asyncio
    async def test_search_repos_basic(self):
        """Test basic repo search."""
        service = GitHubService(token="test-token")
        search_result = {"total_count": 1, "items": [{"full_name": "facebook/react"}]}

        with _mock_http_client(_make_response(200, search_result)):
            result = await service.search_repos("react")

        assert result["total_count"] == 1

    @pytest.mark.asyncio
    async def test_search_repos_with_filters(self):
        """Test repo search with language and min_stars filters."""
        service = GitHubService(token="test-token")

        with _mock_http_client(_make_response(200, {"total_count": 0, "items": []})) as mock_client:
            await service.search_repos("web", language="Python", min_stars=100, topic="api")

            # Verify query params include filters
            call_kwargs = mock_client.get.call_args
            params = call_kwargs.kwargs.get("params", call_kwargs[1].get("params"))
            assert "language:Python" in params["q"]
            assert "stars:>=100" in params["q"]
            assert "topic:api" in params["q"]

    @pytest.mark.asyncio
    async def test_search_repos_star_range(self):
        """Test repo search with min_stars and max_stars produces range syntax."""
        service = GitHubService(token="test-token")

        with _mock_http_client(_make_response(200, {"total_count": 0, "items": []})) as mock_client:
            await service.search_repos("web", min_stars=100, max_stars=5000)

            call_kwargs = mock_client.get.call_args
            params = call_kwargs.kwargs.get("params", call_kwargs[1].get("params"))
            assert "stars:100..5000" in params["q"]

    @pytest.mark.asyncio
    async def test_search_repos_max_stars_only(self):
        """Test repo search with only max_stars."""
        service = GitHubService(token="test-token")

        with _mock_http_client(_make_response(200, {"total_count": 0, "items": []})) as mock_client:
            await service.search_repos("web", max_stars=1000)

            call_kwargs = mock_client.get.call_args
            params = call_kwargs.kwargs.get("params", call_kwargs[1].get("params"))
            assert "stars:<=1000" in params["q"]

    @pytest.mark.asyncio
    async def test_search_repos_license_filter(self):
        """Test repo search with license qualifier."""
        service = GitHubService(token="test-token")

        with _mock_http_client(_make_response(200, {"total_count": 0, "items": []})) as mock_client:
            await service.search_repos("web", license="mit")

            call_kwargs = mock_client.get.call_args
            params = call_kwargs.kwargs.get("params", call_kwargs[1].get("params"))
            assert "license:mit" in params["q"]

    @pytest.mark.asyncio
    async def test_search_repos_hide_archived(self):
        """Test repo search with hide_archived qualifier."""
        service = GitHubService(token="test-token")

        with _mock_http_client(_make_response(200, {"total_count": 0, "items": []})) as mock_client:
            await service.search_repos("web", hide_archived=True)

            call_kwargs = mock_client.get.call_args
            params = call_kwargs.kwargs.get("params", call_kwargs[1].get("params"))
            assert "archived:false" in params["q"]

    @pytest.mark.asyncio
    async def test_search_repos_order_param(self):
        """Test repo search passes order parameter."""
        service = GitHubService(token="test-token")

        with _mock_http_client(_make_response(200, {"total_count": 0, "items": []})) as mock_client:
            await service.search_repos("web", order="asc")

            call_kwargs = mock_client.get.call_args
            params = call_kwargs.kwargs.get("params", call_kwargs[1].get("params"))
            assert params["order"] == "asc"


class TestGitHubServiceStargazers:
    """Tests for GitHubService.get_stargazers_with_dates method."""

    @pytest.mark.asyncio
    async def test_stargazers_exceeds_max_stars(self):
        """Test returns empty list when stars exceed max_stars."""
        service = GitHubService(token="test-token")

        with patch.object(service, 'get_repo', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = {"stargazers_count": 100000}

            result = await service.get_stargazers_with_dates("owner", "repo", max_stars=5000)

        assert result == []

    @pytest.mark.asyncio
    async def test_stargazers_single_page(self):
        """Test fetching stargazers that fit in a single page."""
        service = GitHubService(token="test-token")
        stargazer_data = [
            {"starred_at": "2024-01-15T10:00:00Z", "user": {"login": "user1"}},
            {"starred_at": "2024-01-16T11:00:00Z", "user": {"login": "user2"}},
        ]

        with patch.object(service, 'get_repo', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = {"stargazers_count": 2}

            with _mock_http_client(_make_response(200, stargazer_data)):
                result = await service.get_stargazers_with_dates("owner", "repo", max_stars=5000, per_page=100)

        assert len(result) == 2
        assert result[0]["user"]["login"] == "user1"


class TestStarWrites:
    """star 寫入的真實 HTTP 行為。

    這裡刻意用真的 httpx.Response 與 MockTransport，不用 MagicMock：star 端點回的是
    204 No Content（body 為空），而 MagicMock 的 .json() 是假造的，永遠不會像真的
    一樣拋 JSONDecodeError——本檔其餘測試都用 MagicMock，所以完全測不到這個形狀。
    實際發生過：star 送達 GitHub、回應 204、解析炸掉，端點回 500，本機沒建列，
    使用者看到「加了又自己消失」。
    """

    @staticmethod
    def _service_with(transport: httpx.MockTransport) -> GitHubService:
        service = GitHubService(token="gho_test")
        service._client = httpx.AsyncClient(transport=transport)
        return service

    async def test_star_accepts_an_empty_204_body(self):
        seen: list[tuple[str, str]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append((request.method, request.url.path))
            return httpx.Response(204)

        service = self._service_with(httpx.MockTransport(handler))
        await service.star_repo("a", "one")

        assert seen == [("PUT", "/user/starred/a/one")]

    async def test_unstar_accepts_an_empty_204_body(self):
        seen: list[tuple[str, str]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append((request.method, request.url.path))
            return httpx.Response(204)

        service = self._service_with(httpx.MockTransport(handler))
        await service.unstar_repo("a", "one")

        assert seen == [("DELETE", "/user/starred/a/one")]

    async def test_star_still_raises_on_a_real_error(self):
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(404, json={"message": "Not Found"})

        service = self._service_with(httpx.MockTransport(handler))
        with pytest.raises(GitHubAPIError):
            await service.star_repo("a", "missing")


class TestRedirects:
    """GitHub 對改名或轉移過的 repo 回 301。

    httpx 預設不跟隨導向，所以那種 repo 的抓取會直接失敗——而且是無聲的：
    排程抓取記一筆錯誤就跳過，那個 repo 從此不再更新，畫面上看不出來。
    實測 facebook/react 就是 301 → /repositories/10270250。
    """

    def test_the_real_client_follows_redirects(self):
        """斷言 production 建立的 client 本身，而不是測試自己設好的那一個。

        若在測試裡自建帶 follow_redirects=True 的 client，測到的是測試設定，
        production 改壞了也不會紅。
        """
        service = GitHubService(token="gho_test")

        assert service.client.follow_redirects is True


class TestGetLatestReleaseHandlesNeverReleased:
    """`/releases/latest` 對「從沒發過版」的 repo 回 404，那不是錯誤。

    這條路徑先前沒有測試：把 `if response.status_code == 404: return None`
    拿掉，767 個測試全綠。而該函式的 docstring 自己就記著——94 個追蹤中的
    repo 有 34 個從沒發過版，全部走這條路。少了這個分支，每次版本檢查都會
    對三分之一的清單拋 GitHubNotFoundError。
    """

    @pytest.mark.asyncio
    async def test_never_released_returns_none_instead_of_raising(self):
        service = GitHubService(token="test-token")

        with _mock_http_client(_make_response(404, {"message": "Not Found"})):
            assert await service.get_latest_release("owner", "no-releases") is None

    @pytest.mark.asyncio
    async def test_an_existing_release_still_comes_back(self):
        """對照組：404 那條捷徑不能寬到把正常回應也吃掉。"""
        service = GitHubService(token="test-token")
        payload = {"tag_name": "v2.0.1", "name": "Spring AI 2.0.1"}

        with _mock_http_client(_make_response(200, payload)):
            assert await service.get_latest_release("owner", "has-releases") == payload

    @pytest.mark.asyncio
    async def test_other_errors_still_raise(self):
        """403 之類仍要往外拋——當成「沒發過版」會讓速率限制被靜默吞掉。"""
        service = GitHubService(token="test-token")
        resp = _make_response(403, {"message": "rate limited"},
                              headers={"X-RateLimit-Remaining": "0"})

        with _mock_http_client(resp):
            with pytest.raises((GitHubRateLimitError, GitHubAPIError)):
                await service.get_latest_release("owner", "repo")
