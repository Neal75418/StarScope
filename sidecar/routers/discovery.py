"""
探索 API 端點，用於搜尋 GitHub repo。
"""

from typing import Optional
import logging

from fastapi import APIRouter, Query, HTTPException, Request

from middleware.rate_limit import limiter
from services.github import (
    get_github_service,
    GitHubAPIError,
    GitHubRateLimitError,
)
from schemas.discovery import DiscoveryRepo, SearchResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/discovery", tags=["discovery"])


@router.get("/search", response_model=SearchResponse)
@limiter.limit("30/minute")
async def search_repos(
    request: Request,
    q: str = Query(..., min_length=1, description="Search query"),
    language: Optional[str] = Query(None, description="Filter by language"),
    min_stars: Optional[int] = Query(None, ge=0, description="Minimum star count"),
    topic: Optional[str] = Query(None, description="Filter by topic"),
    sort: str = Query("stars", pattern="^(stars|forks|updated)$", description="Sort field"),
    page: int = Query(1, ge=1, le=100, description="Page number"),
    per_page: int = Query(20, ge=1, le=100, description="Results per page"),
) -> SearchResponse:
    """
    使用 GitHub Search API 搜尋 repo。

    回傳符合搜尋條件的 repo（含可選篩選條件）。
    結果不快取 — 每次請求直接呼叫 GitHub API。

    速率限制：
    - 未認證：10 次/分鐘
    - 已認證：30 次/分鐘
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
        logger.error(f"[探索] GitHub Search API 錯誤: {e}", exc_info=True)
        raise HTTPException(
            status_code=502,
            detail=f"GitHub API error: {str(e)}",
        )

    # 將 GitHub API 回應轉換為我們的 schema
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
