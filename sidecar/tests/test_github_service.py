"""
Tests for GitHub service.
"""

import os
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
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"stargazers_count": 1000}

        result = handle_github_response(mock_response)

        assert result == {"stargazers_count": 1000}

    def test_handles_404_with_raise(self):
        """Test raises GitHubNotFoundError on 404."""
        mock_response = MagicMock()
        mock_response.status_code = 404

        with pytest.raises(GitHubNotFoundError) as exc_info:
            handle_github_response(mock_response, raise_on_error=True, context="owner/repo")

        assert exc_info.value.status_code == 404
        assert "owner/repo" in str(exc_info.value)

    def test_handles_404_without_raise(self):
        """Test returns None on 404 when raise_on_error=False."""
        mock_response = MagicMock()
        mock_response.status_code = 404

        result = handle_github_response(mock_response, raise_on_error=False)

        assert result is None

    def test_handles_403_rate_limit(self):
        """Test raises GitHubRateLimitError on 403."""
        mock_response = MagicMock()
        mock_response.status_code = 403
        mock_response.headers = {"X-RateLimit-Remaining": "0"}

        with pytest.raises(GitHubRateLimitError) as exc_info:
            handle_github_response(mock_response, raise_on_error=True)

        assert exc_info.value.status_code == 403

    def test_handles_403_without_raise(self):
        """Test returns None on 403 when raise_on_error=False."""
        mock_response = MagicMock()
        mock_response.status_code = 403
        mock_response.headers = {"X-RateLimit-Remaining": "0"}

        result = handle_github_response(mock_response, raise_on_error=False, context="test")

        assert result is None

    def test_handles_401_unauthorized(self):
        """Test raises GitHubAPIError on 401."""
        mock_response = MagicMock()
        mock_response.status_code = 401

        with pytest.raises(GitHubAPIError) as exc_info:
            handle_github_response(mock_response, raise_on_error=True)

        assert exc_info.value.status_code == 401
        assert "authentication" in str(exc_info.value).lower()

    def test_handles_401_without_raise(self):
        """Test returns None on 401 when raise_on_error=False."""
        mock_response = MagicMock()
        mock_response.status_code = 401

        result = handle_github_response(mock_response, raise_on_error=False)

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

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"stargazers_count": 1000}

        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

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
