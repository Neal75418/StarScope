"""
Tests for rate limiter retry functionality.
Verifies tenacity retry behavior for GitHub API calls.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.github import (
    GitHubService,
    GitHubRateLimitError,
    GitHubAPIError,
    GitHubNotFoundError,
)
from services.rate_limiter import (
    fetch_repo_with_retry,
    create_github_retry_decorator,
)


class TestFetchRepoWithRetry:
    """Tests for fetch_repo_with_retry function."""

    @pytest.mark.asyncio
    async def test_success_on_first_try(self):
        """Test successful fetch without retries."""
        mock_github = MagicMock(spec=GitHubService)
        mock_github.get_repo = AsyncMock(return_value={"stargazers_count": 1000})

        result = await fetch_repo_with_retry(mock_github, "owner", "repo")

        assert result == {"stargazers_count": 1000}
        assert mock_github.get_repo.call_count == 1

    @pytest.mark.asyncio
    async def test_retry_on_rate_limit_then_success(self):
        """Test retry on rate limit error then success."""
        mock_github = MagicMock(spec=GitHubService)
        mock_github.get_repo = AsyncMock(
            side_effect=[
                GitHubRateLimitError("Rate limited", 403),
                GitHubRateLimitError("Rate limited", 403),
                {"stargazers_count": 100},
            ]
        )

        # Patch wait to speed up test
        with patch("services.rate_limiter.wait_exponential_jitter", return_value=0):
            result = await fetch_repo_with_retry(mock_github, "owner", "repo")

        assert result == {"stargazers_count": 100}
        assert mock_github.get_repo.call_count == 3

    @pytest.mark.asyncio
    async def test_retry_on_api_error_then_success(self):
        """Test retry on transient API error then success."""
        mock_github = MagicMock(spec=GitHubService)
        mock_github.get_repo = AsyncMock(
            side_effect=[
                GitHubAPIError("Server error", 500),
                {"stargazers_count": 200},
            ]
        )

        with patch("services.rate_limiter.wait_exponential_jitter", return_value=0):
            result = await fetch_repo_with_retry(mock_github, "owner", "repo")

        assert result == {"stargazers_count": 200}
        assert mock_github.get_repo.call_count == 2

    @pytest.mark.asyncio
    async def test_no_retry_on_not_found(self):
        """Test that 404 errors are not retried."""
        mock_github = MagicMock(spec=GitHubService)
        mock_github.get_repo = AsyncMock(
            side_effect=GitHubNotFoundError("Not found", 404)
        )

        with pytest.raises(GitHubNotFoundError):
            await fetch_repo_with_retry(mock_github, "owner", "nonexistent")

        # Should only be called once - no retry for 404
        assert mock_github.get_repo.call_count == 1

    @pytest.mark.asyncio
    async def test_retry_exhausted_raises(self):
        """Test that error is raised after all retries exhausted."""
        mock_github = MagicMock(spec=GitHubService)
        mock_github.get_repo = AsyncMock(
            side_effect=GitHubRateLimitError("Rate limited", 403)
        )

        # Create decorator with 3 attempts for faster test
        retry_decorator = create_github_retry_decorator(max_attempts=3)

        @retry_decorator
        async def fetch_with_limited_retry(github, owner, name):
            return await github.get_repo(owner, name)

        with patch("services.rate_limiter.wait_exponential_jitter", return_value=0):
            with pytest.raises(GitHubRateLimitError):
                await fetch_with_limited_retry(mock_github, "owner", "repo")

        assert mock_github.get_repo.call_count == 3


class TestCreateGitHubRetryDecorator:
    """Tests for create_github_retry_decorator factory."""

    def test_custom_max_attempts(self):
        """Test creating decorator with custom max attempts."""
        decorator = create_github_retry_decorator(max_attempts=10)
        assert decorator is not None

    @pytest.mark.asyncio
    async def test_decorator_respects_max_attempts(self):
        """Test that custom max_attempts is respected."""
        call_count = 0

        @create_github_retry_decorator(max_attempts=2)
        async def failing_function():
            nonlocal call_count
            call_count += 1
            raise GitHubRateLimitError("Rate limited", 403)

        with patch("services.rate_limiter.wait_exponential_jitter", return_value=0):
            with pytest.raises(GitHubRateLimitError):
                await failing_function()

        assert call_count == 2
