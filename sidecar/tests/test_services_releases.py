"""
Tests for services/releases.py - GitHub Releases API service.
"""

import pytest
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock, AsyncMock

import httpx

from services.releases import (
    GitHubReleasesService,
    GitHubRelease,
    get_releases_service,
    fetch_releases,
)
from services.github import (
    GitHubAPIError,
    GitHubNotFoundError,
    GitHubRateLimitError,
)


class TestGitHubReleasesService:
    """Tests for GitHubReleasesService class."""

    def test_initialization_without_token(self):
        """Test service initialization without token."""
        service = GitHubReleasesService()

        assert service.token is None
        assert "Accept" in service.headers
        assert "Authorization" not in service.headers

    def test_initialization_with_token(self):
        """Test service initialization with token."""
        service = GitHubReleasesService(token="test-token")

        assert service.token == "test-token"
        assert service.headers["Authorization"] == "Bearer test-token"

    @pytest.mark.asyncio
    async def test_get_releases_success(self):
        """Test successful releases fetch."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = [
            {
                "id": 1,
                "tag_name": "v1.0.0",
                "name": "Release 1.0.0",
                "html_url": "https://github.com/owner/repo/releases/1",
                "body": "Release notes",
                "prerelease": False,
                "draft": False,
                "author": {"login": "maintainer"},
                "published_at": "2024-01-15T12:00:00Z",
                "created_at": "2024-01-15T10:00:00Z",
            }
        ]

        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            service = GitHubReleasesService()
            result = await service.get_releases("owner", "repo")

            assert len(result) == 1
            assert isinstance(result[0], GitHubRelease)
            assert result[0].tag_name == "v1.0.0"
            assert result[0].name == "Release 1.0.0"

    @pytest.mark.asyncio
    async def test_get_releases_with_pagination(self):
        """Test releases fetch respects per_page limit."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = []

        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            service = GitHubReleasesService()
            await service.get_releases("owner", "repo", per_page=50)

            # Verify call was made with correct params
            call_args = mock_client.get.call_args
            assert call_args.kwargs["params"]["per_page"] == 50

    @pytest.mark.asyncio
    async def test_get_releases_caps_at_100(self):
        """Test per_page is capped at 100."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = []

        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            service = GitHubReleasesService()
            await service.get_releases("owner", "repo", per_page=200)

            call_args = mock_client.get.call_args
            assert call_args.kwargs["params"]["per_page"] == 100

    @pytest.mark.asyncio
    async def test_get_releases_handles_404(self):
        """Test raises GitHubNotFoundError on 404."""
        mock_response = MagicMock()
        mock_response.status_code = 404

        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            service = GitHubReleasesService()

            with pytest.raises(GitHubNotFoundError):
                await service.get_releases("owner", "repo")

    @pytest.mark.asyncio
    async def test_get_releases_handles_403(self):
        """Test raises GitHubRateLimitError on 403."""
        mock_response = MagicMock()
        mock_response.status_code = 403
        mock_response.headers = {"X-RateLimit-Remaining": "0"}

        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            service = GitHubReleasesService()

            with pytest.raises(GitHubRateLimitError):
                await service.get_releases("owner", "repo")

    @pytest.mark.asyncio
    async def test_get_releases_handles_401(self):
        """Test raises GitHubAPIError on 401."""
        mock_response = MagicMock()
        mock_response.status_code = 401

        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            service = GitHubReleasesService()

            with pytest.raises(GitHubAPIError):
                await service.get_releases("owner", "repo")

    @pytest.mark.asyncio
    async def test_get_releases_handles_timeout(self):
        """Test raises GitHubAPIError on timeout."""
        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.side_effect = httpx.TimeoutException("Timeout")
            mock_client_class.return_value.__aenter__.return_value = mock_client

            service = GitHubReleasesService()

            with pytest.raises(GitHubAPIError) as exc_info:
                await service.get_releases("owner", "repo")

            assert "Timeout" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_get_releases_handles_network_error(self):
        """Test raises GitHubAPIError on network error."""
        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.side_effect = httpx.RequestError("Network error")
            mock_client_class.return_value.__aenter__.return_value = mock_client

            service = GitHubReleasesService()

            with pytest.raises(GitHubAPIError):
                await service.get_releases("owner", "repo")

    @pytest.mark.asyncio
    async def test_get_latest_release(self):
        """Test get_latest_release returns first release."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = [
            {
                "id": 1,
                "tag_name": "v1.0.0",
                "created_at": "2024-01-15T10:00:00Z",
                "author": {"login": "user"},
            }
        ]

        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            service = GitHubReleasesService()
            result = await service.get_latest_release("owner", "repo")

            assert result is not None
            assert result.tag_name == "v1.0.0"

    @pytest.mark.asyncio
    async def test_get_latest_release_returns_none_when_empty(self):
        """Test get_latest_release returns None when no releases."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = []

        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            service = GitHubReleasesService()
            result = await service.get_latest_release("owner", "repo")

            assert result is None


class TestGetReleasesService:
    """Tests for get_releases_service function."""

    def test_returns_singleton(self):
        """Test returns the same instance."""
        import services.releases as releases_module
        releases_module._default_service = None

        s1 = get_releases_service()
        s2 = get_releases_service()

        assert s1 is s2

    def test_creates_instance(self):
        """Test creates GitHubReleasesService instance."""
        import services.releases as releases_module
        releases_module._default_service = None

        service = get_releases_service()

        assert isinstance(service, GitHubReleasesService)


class TestFetchReleases:
    """Tests for fetch_releases function."""

    @pytest.mark.asyncio
    async def test_returns_releases_on_success(self):
        """Test returns releases on successful fetch."""
        mock_releases = [
            GitHubRelease(
                release_id=1,
                tag_name="v1.0.0",
                name="Release 1.0.0",
                url="https://example.com",
                body="Notes",
                is_prerelease=False,
                is_draft=False,
                author="maintainer",
                published_at=datetime.now(timezone.utc),
                created_at=datetime.now(timezone.utc),
            )
        ]

        with patch.object(GitHubReleasesService, 'get_releases', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_releases

            result = await fetch_releases("owner", "repo")

            assert result == mock_releases

    @pytest.mark.asyncio
    async def test_returns_empty_list_on_not_found(self):
        """Test returns empty list when repo has no releases."""
        with patch.object(GitHubReleasesService, 'get_releases', new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = GitHubNotFoundError("Not found", 404)

            result = await fetch_releases("owner", "repo")

            assert result == []

    @pytest.mark.asyncio
    async def test_returns_none_on_rate_limit(self):
        """Test returns None when rate limited."""
        with patch.object(GitHubReleasesService, 'get_releases', new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = GitHubRateLimitError("Rate limit", 403)

            result = await fetch_releases("owner", "repo")

            assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_on_api_error(self):
        """Test returns None on API error."""
        with patch.object(GitHubReleasesService, 'get_releases', new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = GitHubAPIError("API Error", 500)

            result = await fetch_releases("owner", "repo")

            assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_on_unexpected_error(self):
        """Test returns None on unexpected error."""
        with patch.object(GitHubReleasesService, 'get_releases', new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = Exception("Unexpected error")

            result = await fetch_releases("owner", "repo")

            assert result is None


class TestGitHubReleaseDataclass:
    """Tests for GitHubRelease dataclass."""

    def test_release_creation(self):
        """Test release dataclass creation."""
        release = GitHubRelease(
            release_id=1,
            tag_name="v1.0.0",
            name="Release 1.0.0",
            url="https://example.com",
            body="Release notes",
            is_prerelease=False,
            is_draft=False,
            author="maintainer",
            published_at=datetime.now(timezone.utc),
            created_at=datetime.now(timezone.utc),
        )

        assert release.release_id == 1
        assert release.tag_name == "v1.0.0"
        assert release.is_prerelease is False
        assert release.is_draft is False

    def test_release_with_none_body(self):
        """Test release with None body."""
        release = GitHubRelease(
            release_id=1,
            tag_name="v1.0.0",
            name="Release",
            url="url",
            body=None,
            is_prerelease=False,
            is_draft=False,
            author="user",
            published_at=None,
            created_at=datetime.now(timezone.utc),
        )

        assert release.body is None
        assert release.published_at is None
