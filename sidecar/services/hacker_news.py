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


def _parse_created_at(created_at_str: str) -> datetime:
    """Parse HN timestamp to datetime."""
    try:
        return datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return datetime.now(timezone.utc)


def _parse_hn_hit(hit: dict, seen_ids: set) -> Optional[HNStory]:
    """Parse a single HN API hit into an HNStory, or None if invalid/duplicate."""
    object_id = hit.get("objectID")
    if not object_id or object_id in seen_ids:
        return None

    seen_ids.add(object_id)

    created_at = _parse_created_at(hit.get("created_at", ""))
    story_url = hit.get("url") or f"https://news.ycombinator.com/item?id={object_id}"

    return HNStory(
        object_id=object_id,
        title=hit.get("title", ""),
        url=story_url,
        points=hit.get("points") or 0,
        num_comments=hit.get("num_comments") or 0,
        author=hit.get("author", ""),
        created_at=created_at,
    )


async def _execute_hn_query(
    client: httpx.AsyncClient,
    query: str,
    seen_ids: set,
    stories: List[HNStory],
    errors: List[str]
) -> None:
    """Execute a single HN search query and append results."""
    try:
        response = await client.get(
            HN_SEARCH_API,
            params={"query": query, "tags": "story", "hitsPerPage": 20}
        )

        if response.status_code == 429:
            logger.warning("HN API rate limit exceeded")
            errors.append("Rate limit exceeded")
            return

        response.raise_for_status()
        data = response.json()

        for hit in data.get("hits", []):
            story = _parse_hn_hit(hit, seen_ids)
            if story:
                stories.append(story)

    except httpx.TimeoutException:
        logger.warning(f"HN API timeout for query: {query}")
        errors.append(f"Timeout for {query}")
    except httpx.RequestError as e:
        logger.warning(f"HN API request error for {query}: {e}")
        errors.append(str(e))
    except httpx.HTTPStatusError as e:
        logger.warning(f"HN API HTTP error for {query}: {e}")
        errors.append(f"HTTP {e.response.status_code}")


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
                await _execute_hn_query(client, query, seen_ids, stories, errors)

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
