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
