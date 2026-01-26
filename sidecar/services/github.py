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
        logger.error("GitHub API authentication failed", exc_info=True)
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

    async def get_commit_activity(
        self, owner: str, repo: str, max_retries: int = 3
    ) -> list[dict]:
        """
        Get weekly commit activity for the past year.

        The GitHub Stats API may return 202 while computing statistics.
        We retry with exponential backoff until data is ready.

        Returns:
            List of weekly data: [{week: timestamp, total: int, days: [int x 7]}]
            Empty list if data is unavailable.

        Raises:
            GitHubNotFoundError: Repository not found
            GitHubRateLimitError: Rate limit exceeded
            GitHubAPIError: Other API errors
        """
        import asyncio

        url = f"{GITHUB_API_BASE}/repos/{owner}/{repo}/stats/commit_activity"

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            for attempt in range(max_retries):
                response = await client.get(url, headers=self.headers)

                # 202 means GitHub is computing the stats, retry after delay
                if response.status_code == 202:
                    if attempt < max_retries - 1:
                        delay = 2 ** attempt  # 1s, 2s, 4s
                        logger.info(
                            f"GitHub computing stats for {owner}/{repo}, "
                            f"retrying in {delay}s (attempt {attempt + 1}/{max_retries})"
                        )
                        await asyncio.sleep(delay)
                        continue
                    # Max retries reached, return empty
                    logger.warning(
                        f"GitHub stats not ready after {max_retries} attempts for {owner}/{repo}"
                    )
                    return []

                # 204 means no content (empty repo)
                if response.status_code == 204:
                    return []

                # Handle standard responses
                data = handle_github_response(
                    response, raise_on_error=True, context=f"{owner}/{repo}/stats/commit_activity"
                )
                return data if data else []

        return []

    async def get_languages(self, owner: str, repo: str) -> dict[str, int]:
        """
        Get language statistics for a repository.

        Returns:
            Dict mapping language name to bytes of code: {"Python": 123456, ...}
            Empty dict if unavailable.

        Raises:
            GitHubNotFoundError: Repository not found
            GitHubRateLimitError: Rate limit exceeded
            GitHubAPIError: Other API errors
        """
        url = f"{GITHUB_API_BASE}/repos/{owner}/{repo}/languages"

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(url, headers=self.headers)
            data = handle_github_response(
                response, raise_on_error=True, context=f"{owner}/{repo}/languages"
            )
            return data if data else {}

    async def search_repos(
        self,
        query: str,
        language: Optional[str] = None,
        min_stars: Optional[int] = None,
        topic: Optional[str] = None,
        sort: str = "stars",
        order: str = "desc",
        page: int = 1,
        per_page: int = 20,
    ) -> dict:
        """
        Search GitHub repositories using the Search API.

        Args:
            query: Search query string
            language: Filter by programming language
            min_stars: Filter by minimum star count
            topic: Filter by topic
            sort: Sort field (stars, forks, updated)
            order: Sort order (asc, desc)
            page: Page number (1-indexed)
            per_page: Results per page (max 100)

        Returns:
            GitHub Search API response with items and total_count

        Raises:
            GitHubRateLimitError: Rate limit exceeded (Search API: 30/min)
            GitHubAPIError: Other API errors
        """
        # Build query with filters
        q_parts = [query]
        if language:
            q_parts.append(f"language:{language}")
        if min_stars is not None and min_stars > 0:
            q_parts.append(f"stars:>={min_stars}")
        if topic:
            q_parts.append(f"topic:{topic}")

        full_query = " ".join(q_parts)

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                f"{GITHUB_API_BASE}/search/repositories",
                headers=self.headers,
                params={
                    "q": full_query,
                    "sort": sort,
                    "order": order,
                    "page": page,
                    "per_page": per_page,
                },
            )
            return handle_github_response(
                response, raise_on_error=True, context=f"search: {query}"
            )

    async def get_stargazers_with_dates(
        self,
        owner: str,
        repo: str,
        max_stars: int = 5000,
        per_page: int = 100,
    ) -> list[dict]:
        """
        Get stargazers with timestamps for a repository.

        Uses GitHub's stargazers API with special Accept header to get timestamps.
        Limited to repos with < max_stars to avoid rate limit exhaustion.

        Args:
            owner: Repository owner
            repo: Repository name
            max_stars: Maximum stars allowed (rejects if repo has more)
            per_page: Results per page (max 100)

        Returns:
            List of stargazers: [{"starred_at": "2024-01-15T...", "user": {...}}, ...]
            Empty list if repo exceeds max_stars limit.

        Raises:
            GitHubNotFoundError: Repository not found
            GitHubRateLimitError: Rate limit exceeded
            GitHubAPIError: Other API errors
        """
        # First, check if repo exceeds star limit
        repo_data = await self.get_repo(owner, repo)
        star_count = repo_data.get("stargazers_count", 0)

        if star_count > max_stars:
            logger.warning(
                f"Repository {owner}/{repo} has {star_count} stars, "
                f"exceeding limit of {max_stars}. Skipping stargazers fetch."
            )
            return []

        # Special header to get starred_at timestamps
        headers = {
            **self.headers,
            "Accept": "application/vnd.github.star+json",
        }

        all_stargazers = []
        page = 1

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            while True:
                response = await client.get(
                    f"{GITHUB_API_BASE}/repos/{owner}/{repo}/stargazers",
                    headers=headers,
                    params={"per_page": per_page, "page": page},
                )

                data = handle_github_response(
                    response, raise_on_error=True, context=f"{owner}/{repo}/stargazers?page={page}"
                )

                if not data:
                    break

                all_stargazers.extend(data)

                # Check if there are more pages
                if len(data) < per_page:
                    break

                page += 1

                # Safety limit to prevent infinite loops
                if page > 100:  # Max 10,000 stars
                    logger.warning(f"Reached page limit for {owner}/{repo} stargazers")
                    break

        logger.info(f"Fetched {len(all_stargazers)} stargazers for {owner}/{repo}")
        return all_stargazers


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
        logger.error(f"GitHub rate limit exceeded: {e}", exc_info=True)
        return None
    except GitHubAPIError as e:
        logger.error(f"GitHub API error for {owner}/{repo}: {e}", exc_info=True)
        return None
    except httpx.TimeoutException:
        logger.error(f"Timeout fetching {owner}/{repo}", exc_info=True)
        return None
    except httpx.RequestError as e:
        logger.error(f"Network error fetching {owner}/{repo}: {e}", exc_info=True)
        return None
