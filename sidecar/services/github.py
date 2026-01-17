"""
GitHub API service.
Handles fetching repository data from GitHub.
"""

import httpx
from typing import Optional

GITHUB_API_BASE = "https://api.github.com"


class GitHubService:
    def __init__(self, token: Optional[str] = None):
        self.token = token
        self.headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if token:
            self.headers["Authorization"] = f"Bearer {token}"

    async def get_repo(self, owner: str, repo: str) -> dict:
        """
        Get repository information.
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{GITHUB_API_BASE}/repos/{owner}/{repo}",
                headers=self.headers,
            )
            response.raise_for_status()
            return response.json()

    async def get_repo_stargazers_count(self, owner: str, repo: str) -> int:
        """
        Get the current star count for a repository.
        """
        data = await self.get_repo(owner, repo)
        return data.get("stargazers_count", 0)


# Module-level convenience function for scheduler
_default_service: Optional[GitHubService] = None


def get_github_service() -> GitHubService:
    """Get the default GitHub service instance."""
    global _default_service
    if _default_service is None:
        _default_service = GitHubService()
    return _default_service


async def fetch_repo_data(owner: str, repo: str) -> Optional[dict]:
    """
    Fetch repository data from GitHub.
    Returns None if the request fails.
    """
    try:
        service = get_github_service()
        return await service.get_repo(owner, repo)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            return None
        raise
    except Exception:
        return None
