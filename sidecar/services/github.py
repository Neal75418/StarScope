"""
GitHub API service.
Handles fetching repository data from GitHub.
"""

import logging
import os
import httpx
from typing import Optional

from constants import GITHUB_API_TIMEOUT_SECONDS, GITHUB_TOKEN_ENV_VAR
from db.models import AppSettingKey

logger = logging.getLogger(__name__)

GITHUB_API_BASE = "https://api.github.com"


# Exception classes
class GitHubAPIError(Exception):
    """Custom exception for GitHub API errors."""
    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


class GitHubRateLimitError(GitHubAPIError):
    """Raised when GitHub API rate limit is exceeded."""
    pass


class GitHubNotFoundError(GitHubAPIError):
    """Raised when repository is not found."""
    pass


# Shared utilities for GitHub API requests
def build_github_headers(token: Optional[str] = None) -> dict:
    """Build standard GitHub API headers."""
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def handle_github_response(
    response: "httpx.Response",
    raise_on_error: bool = True,
    context: str = ""
) -> Optional[dict]:
    """
    Handle GitHub API response with standard error checking.

    Args:
        response: The httpx response object
        raise_on_error: If True, raise exceptions; if False, return None on errors
        context: Context string for error messages (e.g., "owner/repo")

    Returns:
        JSON response dict, or None if raise_on_error=False and error occurred

    Raises:
        GitHubNotFoundError: If 404 and raise_on_error=True
        GitHubRateLimitError: If 403 and raise_on_error=True
        GitHubAPIError: If 401 or other errors and raise_on_error=True
    """
    if response.status_code == 404:
        if raise_on_error:
            raise GitHubNotFoundError(
                f"Resource not found: {context}" if context else "Resource not found",
                status_code=404
            )
        return None

    if response.status_code == 403:
        remaining = response.headers.get("X-RateLimit-Remaining", "unknown")
        if raise_on_error:
            raise GitHubRateLimitError(
                f"GitHub API rate limit exceeded (remaining: {remaining})",
                status_code=403
            )
        logger.warning(f"Rate limit or forbidden: {context}")
        return None

    if response.status_code == 401:
        if raise_on_error:
            raise GitHubAPIError(
                "GitHub API authentication failed - check token",
                status_code=401
            )
        logger.error("GitHub API authentication failed")
        return None

    response.raise_for_status()
    return response.json()


class GitHubService:
    def __init__(self, token: Optional[str] = None, timeout: float = GITHUB_API_TIMEOUT_SECONDS):
        self.token = token
        self.timeout = timeout
        self.headers = build_github_headers(token)

    async def get_repo(self, owner: str, repo: str) -> dict:
        """
        Get repository information.

        Raises:
            GitHubNotFoundError: Repository not found (404)
            GitHubRateLimitError: Rate limit exceeded (403)
            GitHubAPIError: Other API errors
        """
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                f"{GITHUB_API_BASE}/repos/{owner}/{repo}",
                headers=self.headers,
            )
            return handle_github_response(
                response,
                raise_on_error=True,
                context=f"{owner}/{repo}"
            )

    async def get_repo_stargazers_count(self, owner: str, repo: str) -> int:
        """
        Get the current star count for a repository.
        """
        data = await self.get_repo(owner, repo)
        return data.get("stargazers_count", 0)


# Module-level convenience function for scheduler
_default_service: Optional[GitHubService] = None


def get_github_service() -> GitHubService:
    """
    Get the default GitHub service instance.

    Token priority:
    1. Database (from OAuth Device Flow)
    2. Environment variable (legacy fallback)

    The service is cached as a singleton for the application lifetime.
    Call reset_github_service() to refresh when token changes.
    """
    global _default_service
    if _default_service is None:
        token = None

        # First, try to get token from database (OAuth Device Flow)
        try:
            from services.settings import get_setting
            token = get_setting(AppSettingKey.GITHUB_TOKEN)
            if token:
                logger.info("Using GitHub token from database (OAuth)")
        except Exception as e:
            logger.debug(f"Could not read token from database: {e}")

        # Fallback to environment variable
        if not token:
            token = os.getenv(GITHUB_TOKEN_ENV_VAR)
            if token:
                logger.info("Using GitHub token from environment variable")

        _default_service = GitHubService(token=token)
    return _default_service


def reset_github_service() -> None:
    """
    Reset the default GitHub service instance.

    Useful for testing or when the token needs to be refreshed.
    """
    global _default_service
    _default_service = None


async def fetch_repo_data(owner: str, repo: str) -> Optional[dict]:
    """
    Fetch repository data from GitHub.
    Returns None if the request fails.
    """
    try:
        service = get_github_service()
        return await service.get_repo(owner, repo)
    except GitHubNotFoundError:
        logger.warning(f"Repository not found: {owner}/{repo}")
        return None
    except GitHubRateLimitError as e:
        logger.error(f"GitHub rate limit exceeded: {e}")
        return None
    except GitHubAPIError as e:
        logger.error(f"GitHub API error for {owner}/{repo}: {e}")
        return None
    except httpx.TimeoutException:
        logger.error(f"Timeout fetching {owner}/{repo}")
        return None
    except httpx.RequestError as e:
        logger.error(f"Network error fetching {owner}/{repo}: {e}")
        return None
