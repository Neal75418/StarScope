"""
Discovery API endpoints for searching GitHub repositories.
"""

from typing import Optional
import logging

from fastapi import APIRouter, Query, HTTPException

from services.github import (
    get_github_service,
    GitHubAPIError,
    GitHubRateLimitError,
)
from schemas.discovery import DiscoveryRepo, SearchResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/discovery", tags=["discovery"])


@router.get("/search", response_model=SearchResponse)
async def search_repos(
    q: str = Query(..., min_length=1, description="Search query"),
    language: Optional[str] = Query(None, description="Filter by language"),
    min_stars: Optional[int] = Query(None, ge=0, description="Minimum star count"),
    topic: Optional[str] = Query(None, description="Filter by topic"),
    sort: str = Query("stars", pattern="^(stars|forks|updated)$", description="Sort field"),
    page: int = Query(1, ge=1, le=100, description="Page number"),
    per_page: int = Query(20, ge=1, le=100, description="Results per page"),
) -> SearchResponse:
    """
    Search GitHub repositories using the GitHub Search API.

    Returns repositories matching the search query with optional filters.
    Results are not cached - each request hits the GitHub API directly.

    Rate limits:
    - Unauthenticated: 10 requests/minute
    - Authenticated: 30 requests/minute
    """
    github = get_github_service()

    try:
        result = await github.search_repos(
            query=q,
            language=language,
            min_stars=min_stars,
            topic=topic,
            sort=sort,
            page=page,
            per_page=per_page,
        )
    except GitHubRateLimitError:
        raise HTTPException(
            status_code=429,
            detail="GitHub API rate limit exceeded. Please try again later.",
        )
    except GitHubAPIError as e:
        logger.error(f"GitHub search API error: {e}", exc_info=True)
        raise HTTPException(
            status_code=502,
            detail=f"GitHub API error: {str(e)}",
        )

    # Transform GitHub API response to our schema
    repos = [
        DiscoveryRepo(
            id=item["id"],
            full_name=item["full_name"],
            owner=item["owner"]["login"],
            name=item["name"],
            description=item.get("description"),
            language=item.get("language"),
            stars=item["stargazers_count"],
            forks=item["forks_count"],
            url=item["html_url"],
            topics=item.get("topics", []),
            created_at=item["created_at"],
            updated_at=item["updated_at"],
        )
        for item in result.get("items", [])
    ]

    total_count = result.get("total_count", 0)

    return SearchResponse(
        repos=repos,
        total_count=total_count,
        page=page,
        per_page=per_page,
        has_more=page * per_page < total_count,
    )
