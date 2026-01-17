"""
GitHub Releases service.
Fetches release information for repositories.
Follows the same patterns as github.py.
"""

import logging
from typing import Optional, List
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

from constants import GITHUB_API_TIMEOUT_SECONDS
from services.github import GitHubAPIError, GitHubNotFoundError, GitHubRateLimitError

logger = logging.getLogger(__name__)

GITHUB_API_BASE = "https://api.github.com"


@dataclass
class GitHubRelease:
    """Parsed GitHub release."""
    release_id: int
    tag_name: str
    name: str
    url: str
    body: Optional[str]
    is_prerelease: bool
    is_draft: bool
    author: str
    published_at: Optional[datetime]
    created_at: datetime


class GitHubReleasesService:
    """Service for fetching GitHub releases."""

    def __init__(self, token: Optional[str] = None, timeout: float = GITHUB_API_TIMEOUT_SECONDS):
        self.token = token
        self.timeout = timeout
        self.headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if token:
            self.headers["Authorization"] = f"Bearer {token}"

    def _handle_error_response(self, response: httpx.Response, owner: str, repo: str) -> None:
        """Handle error responses from GitHub API."""
        if response.status_code == 404:
            raise GitHubNotFoundError(
                f"Repository {owner}/{repo} not found or has no releases",
                status_code=404
            )
        if response.status_code == 403:
            remaining = response.headers.get("X-RateLimit-Remaining", "unknown")
            raise GitHubRateLimitError(
                f"GitHub API rate limit exceeded (remaining: {remaining})",
                status_code=403
            )
        if response.status_code == 401:
            raise GitHubAPIError(
                "GitHub API authentication failed - check token",
                status_code=401
            )

    async def get_releases(self, owner: str, repo: str, per_page: int = 10) -> List[GitHubRelease]:
        """
        Get releases for a repository.

        Args:
            owner: Repository owner
            repo: Repository name
            per_page: Number of releases to fetch (max 100)

        Returns:
            List of GitHubRelease objects

        Raises:
            GitHubAPIError: If the API request fails
        """
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                response = await client.get(
                    f"{GITHUB_API_BASE}/repos/{owner}/{repo}/releases",
                    params={"per_page": min(per_page, 100)},
                    headers=self.headers,
                )

                self._handle_error_response(response, owner, repo)
                response.raise_for_status()

                releases: List[GitHubRelease] = []
                for release_data in response.json():
                    # Parse published_at timestamp
                    published_at = None
                    if release_data.get("published_at"):
                        try:
                            published_at = datetime.fromisoformat(
                                release_data["published_at"].replace("Z", "+00:00")
                            )
                        except (ValueError, AttributeError):
                            pass

                    # Parse created_at timestamp
                    try:
                        created_at = datetime.fromisoformat(
                            release_data["created_at"].replace("Z", "+00:00")
                        )
                    except (ValueError, AttributeError):
                        created_at = datetime.now(timezone.utc)

                    releases.append(GitHubRelease(
                        release_id=release_data["id"],
                        tag_name=release_data.get("tag_name", ""),
                        name=release_data.get("name") or release_data.get("tag_name", ""),
                        url=release_data.get("html_url", ""),
                        body=release_data.get("body"),
                        is_prerelease=release_data.get("prerelease", False),
                        is_draft=release_data.get("draft", False),
                        author=release_data.get("author", {}).get("login", "unknown"),
                        published_at=published_at,
                        created_at=created_at,
                    ))

                return releases

            except httpx.TimeoutException:
                logger.error(f"GitHub API timeout fetching releases for {owner}/{repo}")
                raise GitHubAPIError(f"Timeout fetching releases for {owner}/{repo}")
            except httpx.RequestError as e:
                logger.error(f"GitHub API request error: {e}")
                raise GitHubAPIError(f"Failed to reach GitHub API: {e}")
            except httpx.HTTPStatusError as e:
                logger.error(f"GitHub API HTTP error: {e}")
                raise GitHubAPIError(
                    f"GitHub API error: {e.response.status_code}",
                    status_code=e.response.status_code
                )

    async def get_latest_release(self, owner: str, repo: str) -> Optional[GitHubRelease]:
        """Get the latest release for a repository."""
        releases = await self.get_releases(owner, repo, per_page=1)
        return releases[0] if releases else None


# Module-level convenience functions
_default_service: Optional[GitHubReleasesService] = None


def get_releases_service() -> GitHubReleasesService:
    """Get the default releases service instance."""
    global _default_service
    if _default_service is None:
        _default_service = GitHubReleasesService()
    return _default_service


async def fetch_releases(owner: str, repo_name: str) -> Optional[List[GitHubRelease]]:
    """
    Convenience function to fetch GitHub releases for a repo.
    Returns None if the request fails.
    """
    try:
        service = get_releases_service()
        return await service.get_releases(owner, repo_name)
    except GitHubNotFoundError:
        # Not an error - repo may not have releases
        logger.debug(f"No releases found for {owner}/{repo_name}")
        return []
    except GitHubRateLimitError as e:
        logger.error(f"GitHub rate limit exceeded: {e}")
        return None
    except GitHubAPIError as e:
        logger.error(f"Failed to fetch releases for {owner}/{repo_name}: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error fetching releases for {owner}/{repo_name}: {e}")
        return None
