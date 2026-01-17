"""
Reddit API service.
Searches programming subreddits for repository mentions.
Uses public JSON endpoints (no OAuth required for read-only).
"""

import logging
from typing import Optional, List
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

from constants import REDDIT_API_TIMEOUT_SECONDS

logger = logging.getLogger(__name__)

# Subreddits to search for programming projects
PROGRAMMING_SUBREDDITS = [
    "programming",
    "golang",
    "rust",
    "python",
    "javascript",
    "typescript",
    "java",
    "opensource",
    "github",
    "webdev",
    "devops",
]


class RedditAPIError(Exception):
    """Custom exception for Reddit API errors."""
    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


@dataclass
class RedditPost:
    """Parsed Reddit post."""
    post_id: str
    title: str
    url: str
    permalink: str
    score: int
    num_comments: int
    author: str
    subreddit: str
    created_at: datetime


class RedditService:
    """Service for searching Reddit via public JSON API."""

    def __init__(self, timeout: float = REDDIT_API_TIMEOUT_SECONDS):
        self.timeout = timeout
        self.headers = {
            "User-Agent": "StarScope/1.0 (GitHub Project Intelligence Desktop App)"
        }

    async def search_repo(self, repo_name: str, owner: str) -> List[RedditPost]:
        """
        Search Reddit for mentions of a repository.
        Searches for both "owner/repo" and just "repo" name for better coverage.

        Args:
            repo_name: Repository name
            owner: Repository owner

        Returns:
            List of RedditPost objects

        Raises:
            RedditAPIError: Only if all queries fail
        """
        posts: List[RedditPost] = []
        seen_ids: set = set()
        errors: List[str] = []

        # Search with full name first (more specific), then repo name alone
        queries = [f"{owner}/{repo_name}", repo_name]

        # Search across multiple programming subreddits
        subreddit_str = "+".join(PROGRAMMING_SUBREDDITS)
        url = f"https://www.reddit.com/r/{subreddit_str}/search.json"

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            for query in queries:
                try:
                    response = await client.get(
                        url,
                        params={
                            "q": query,
                            "sort": "relevance",
                            "limit": 25,
                            "restrict_sr": "true",
                            "t": "all",  # All time
                        },
                        headers=self.headers,
                    )

                    if response.status_code == 429:
                        logger.warning("Reddit API rate limit exceeded")
                        errors.append("Rate limit exceeded")
                        continue  # Try next query

                    if response.status_code == 403:
                        logger.warning("Reddit API forbidden - may need to adjust User-Agent")
                        errors.append("Access forbidden")
                        continue  # Try next query

                    response.raise_for_status()
                    data = response.json()

                    for child in data.get("data", {}).get("children", []):
                        post_data = child.get("data", {})
                        post_id = post_data.get("id", "")

                        # Skip duplicates and removed/deleted posts
                        if not post_id or post_id in seen_ids:
                            continue
                        if post_data.get("removed_by_category") or post_data.get("author") == "[deleted]":
                            continue

                        seen_ids.add(post_id)

                        # Parse created_utc timestamp
                        created_utc = post_data.get("created_utc", 0)
                        try:
                            created_at = datetime.fromtimestamp(created_utc, tz=timezone.utc)
                        except (ValueError, OSError):
                            created_at = datetime.now(timezone.utc)

                        posts.append(RedditPost(
                            post_id=post_id,
                            title=post_data.get("title", ""),
                            url=post_data.get("url", ""),
                            permalink=f"https://reddit.com{post_data.get('permalink', '')}",
                            score=post_data.get("score", 0),
                            num_comments=post_data.get("num_comments", 0),
                            author=post_data.get("author", "unknown"),
                            subreddit=post_data.get("subreddit", ""),
                            created_at=created_at,
                        ))

                except httpx.TimeoutException:
                    logger.warning(f"Reddit API timeout for query: {query}")
                    errors.append(f"Timeout for {query}")
                    continue  # Try next query
                except httpx.RequestError as e:
                    logger.warning(f"Reddit API request error for {query}: {e}")
                    errors.append(str(e))
                    continue  # Try next query
                except httpx.HTTPStatusError as e:
                    logger.warning(f"Reddit API HTTP error for {query}: {e}")
                    errors.append(f"HTTP {e.response.status_code}")
                    continue  # Try next query

        # Only raise error if all queries failed and no results
        if not posts and errors:
            raise RedditAPIError(f"All queries failed: {'; '.join(errors)}")

        # Sort by score (highest first)
        posts.sort(key=lambda p: p.score, reverse=True)

        return posts


# Module-level convenience functions
_default_service: Optional[RedditService] = None


def get_reddit_service() -> RedditService:
    """Get the default Reddit service instance."""
    global _default_service
    if _default_service is None:
        _default_service = RedditService()
    return _default_service


async def fetch_reddit_mentions(owner: str, repo_name: str) -> Optional[List[RedditPost]]:
    """
    Convenience function to fetch Reddit mentions for a repo.
    Returns None if the request fails.
    """
    try:
        service = get_reddit_service()
        return await service.search_repo(repo_name, owner)
    except RedditAPIError as e:
        logger.error(f"Failed to fetch Reddit mentions for {owner}/{repo_name}: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error fetching Reddit mentions for {owner}/{repo_name}: {e}")
        return None
