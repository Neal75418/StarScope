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
    async def test_fetch_repo_data_not_found(self):
        """Test returns None when repo not found."""
        reset_github_service()

        with patch.object(GitHubService, 'get_repo', new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = GitHubNotFoundError("Not found", 404)

            result = await fetch_repo_data("owner", "nonexistent")

            assert result is None

        reset_github_service()

    @pytest.mark.asyncio
    async def test_fetch_repo_data_rate_limit(self):
        """Test returns None when rate limited."""
        reset_github_service()

        with patch.object(GitHubService, 'get_repo', new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = GitHubRateLimitError("Rate limit", 403)

            result = await fetch_repo_data("owner", "repo")

            assert result is None

        reset_github_service()

    @pytest.mark.asyncio
    async def test_fetch_repo_data_api_error(self):
        """Test returns None on generic API error."""
        reset_github_service()

        with patch.object(GitHubService, 'get_repo', new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = GitHubAPIError("API Error", 500)

            result = await fetch_repo_data("owner", "repo")

            assert result is None

        reset_github_service()

    @pytest.mark.asyncio
    async def test_fetch_repo_data_timeout(self):
        """Test returns None on timeout."""
        reset_github_service()

        with patch.object(GitHubService, 'get_repo', new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = httpx.TimeoutException("Timeout")

            result = await fetch_repo_data("owner", "repo")

            assert result is None

        reset_github_service()

    @pytest.mark.asyncio
    async def test_fetch_repo_data_network_error(self):
        """Test returns None on network error."""
        reset_github_service()

        with patch.object(GitHubService, 'get_repo', new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = httpx.RequestError("Network error")

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

        service1 = get_github_service()
        service2 = get_github_service()
        assert service1 is service2

        # Clean up
        reset_github_service()

    def test_reset_github_service(self):
        """Test that reset_github_service creates new instance."""
        from services.github import get_github_service, reset_github_service

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


class TestGitHubAPIError:
    """Test cases for GitHub API error classes."""

    def test_github_api_error(self):
        """Test GitHubAPIError creation."""
        from services.github import GitHubAPIError

        error = GitHubAPIError("Test error", status_code=500)
        assert str(error) == "Test error"
        assert error.status_code == 500

    def test_github_not_found_error(self):
        """Test GitHubNotFoundError creation."""
        from services.github import GitHubNotFoundError

        error = GitHubNotFoundError("Repo not found", status_code=404)
        assert "not found" in str(error).lower()
        assert error.status_code == 404

    def test_github_rate_limit_error(self):
        """Test GitHubRateLimitError creation."""
        from services.github import GitHubRateLimitError

        error = GitHubRateLimitError("Rate limit exceeded", status_code=403)
        assert error.status_code == 403


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
