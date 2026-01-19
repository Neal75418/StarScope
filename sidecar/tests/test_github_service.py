"""
Tests for GitHub service.
"""

import os
from unittest.mock import patch

class TestGitHubService:
    """Test cases for GitHub service."""

    def test_get_github_service_reads_token_from_env(self):
        """Test that get_github_service reads token from environment."""
        from services.github import get_github_service, reset_github_service

        # Reset to ensure clean state
        reset_github_service()

        with patch.dict(os.environ, {"GITHUB_TOKEN": "test-token-123"}):
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

        # Remove token from environment if present
        env = os.environ.copy()
        env.pop("GITHUB_TOKEN", None)

        with patch.dict(os.environ, env, clear=True):
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
