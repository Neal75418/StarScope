"""
Hacker News API service.
Searches for repository mentions using the Algolia HN Search API.
API: https://hn.algolia.com/api
"""

import logging
from typing import Optional, List
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

from constants import HN_API_TIMEOUT_SECONDS

logger = logging.getLogger(__name__)

HN_SEARCH_API = "https://hn.algolia.com/api/v1/search"


class HackerNewsAPIError(Exception):
    """Custom exception for HN API errors."""
    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


@dataclass
class HNStory:
    """Parsed Hacker News story."""
    object_id: str
    title: str
    url: str
    points: int
    num_comments: int
    author: str
    created_at: datetime


class HackerNewsService:
    """Service for searching Hacker News via Algolia API."""

    def __init__(self, timeout: float = HN_API_TIMEOUT_SECONDS):
        self.timeout = timeout

    async def search_repo(self, repo_name: str, owner: str) -> List[HNStory]:
        """
        Search HN for mentions of a repository.
        Searches for both "owner/repo" and just "repo" name.

        Args:
            repo_name: Repository name
            owner: Repository owner

        Returns:
            List of HNStory objects

        Raises:
            HackerNewsAPIError: Only if all queries fail
        """
        stories: List[HNStory] = []
        seen_ids: set = set()
        errors: List[str] = []

        # Search with full name first (more specific), then repo name alone
        queries = [f"{owner}/{repo_name}", repo_name]

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            for query in queries:
                try:
                    response = await client.get(
                        HN_SEARCH_API,
                        params={
                            "query": query,
                            "tags": "story",
                            "hitsPerPage": 20,
                        }
                    )

                    if response.status_code == 429:
                        logger.warning("HN API rate limit exceeded")
                        errors.append("Rate limit exceeded")
                        continue  # Try next query instead of failing

                    response.raise_for_status()
                    data = response.json()

                    for hit in data.get("hits", []):
                        object_id = hit.get("objectID")
                        if not object_id or object_id in seen_ids:
                            continue

                        seen_ids.add(object_id)

                        # Parse created_at timestamp
                        created_at_str = hit.get("created_at", "")
                        try:
                            created_at = datetime.fromisoformat(
                                created_at_str.replace("Z", "+00:00")
                            )
                        except (ValueError, AttributeError):
                            created_at = datetime.now(timezone.utc)

                        # Build story URL - use HN link if no external URL
                        story_url = hit.get("url") or f"https://news.ycombinator.com/item?id={object_id}"

                        stories.append(HNStory(
                            object_id=object_id,
                            title=hit.get("title", ""),
                            url=story_url,
                            points=hit.get("points") or 0,
                            num_comments=hit.get("num_comments") or 0,
                            author=hit.get("author", ""),
                            created_at=created_at,
                        ))

                except httpx.TimeoutException:
                    logger.warning(f"HN API timeout for query: {query}")
                    errors.append(f"Timeout for {query}")
                    continue  # Try next query
                except httpx.RequestError as e:
                    logger.warning(f"HN API request error for {query}: {e}")
                    errors.append(str(e))
                    continue  # Try next query
                except httpx.HTTPStatusError as e:
                    logger.warning(f"HN API HTTP error for {query}: {e}")
                    errors.append(f"HTTP {e.response.status_code}")
                    continue  # Try next query

        # Only raise error if all queries failed and no results
        if not stories and errors:
            raise HackerNewsAPIError(f"All queries failed: {'; '.join(errors)}")

        # Sort by points (highest first)
        stories.sort(key=lambda s: s.points, reverse=True)

        return stories


# Module-level convenience functions
_default_service: Optional[HackerNewsService] = None


def get_hn_service() -> HackerNewsService:
    """Get the default HN service instance."""
    global _default_service
    if _default_service is None:
        _default_service = HackerNewsService()
    return _default_service


async def fetch_hn_mentions(owner: str, repo_name: str) -> Optional[List[HNStory]]:
    """
    Convenience function to fetch HN mentions for a repo.
    Returns None if the request fails.
    """
    try:
        service = get_hn_service()
        return await service.search_repo(repo_name, owner)
    except HackerNewsAPIError as e:
        logger.error(f"Failed to fetch HN mentions for {owner}/{repo_name}: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error fetching HN mentions for {owner}/{repo_name}: {e}")
        return None
