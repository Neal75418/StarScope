"""
趨勢 API 端點，依各種指標排序檢視 repo。
"""

from enum import Enum

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from db.database import get_db
from constants import SignalType
from services.queries import build_signal_map, build_stars_map, query_trending_repos
from schemas.response import ApiResponse, success_response

router = APIRouter(prefix="/api/trends", tags=["trends"])


class SortBy(str, Enum):
    """趨勢的可用排序選項。"""
    VELOCITY = "velocity"
    STARS_DELTA_7D = "stars_delta_7d"
    STARS_DELTA_30D = "stars_delta_30d"
    ACCELERATION = "acceleration"
    FORKS_DELTA_7D = "forks_delta_7d"
    ISSUES_DELTA_7D = "issues_delta_7d"


class TrendingRepo(BaseModel):
    """含趨勢指標的 repo。"""
    id: int
    owner: str
    name: str
    full_name: str
    url: str
    description: str | None
    language: str | None
    stars: int | None
    stars_delta_7d: float | None
    stars_delta_30d: float | None
    velocity: float | None
    acceleration: float | None
    trend: int | None
    # Fork 與 Issue 趨勢
    forks_delta_7d: float | None = None
    forks_delta_30d: float | None = None
    issues_delta_7d: float | None = None
    issues_delta_30d: float | None = None
    rank: int

    model_config = ConfigDict(from_attributes=True)


class TrendsResponse(BaseModel):
    """趨勢列表的回應。"""
    repos: list[TrendingRepo]
    total: int
    sort_by: str


@router.get("/", response_model=ApiResponse[TrendsResponse])
async def get_trends(
    sort_by: SortBy = Query(SortBy.VELOCITY, description="Sort by which metric"),
    limit: int = Query(50, ge=1, le=100, description="Maximum number of results"),
    language: str | None = Query(None, description="Filter by programming language"),
    min_stars: int | None = Query(None, ge=0, description="Minimum star count"),
    db: Session = Depends(get_db)
) -> dict:
    """
    依趨勢指標排序取得 repo。

    可用排序選項：
    - velocity: 每日 star 數（7 天平均）
    - stars_delta_7d: 7 天內增加的 star 數
    - stars_delta_30d: 30 天內增加的 star 數
    - acceleration: velocity 的變化率
    """
    results = query_trending_repos(db, sort_by.value, limit, language, min_stars)

    if not results:
        empty_response = TrendsResponse(repos=[], total=0, sort_by=sort_by.value)
        return success_response(
            data=empty_response,
            message=f"No trending repositories found (sorted by {sort_by.value})"
        )

    repo_ids = [repo.id for repo in results]
    signal_map = build_signal_map(db, repo_ids)
    stars_map = build_stars_map(db, repo_ids)

    trending_repos = []
    for rank, repo in enumerate(results, start=1):
        signals = signal_map.get(int(repo.id), {})
        trend_val = signals.get(SignalType.TREND)

        trending_repos.append(TrendingRepo(
            id=repo.id,
            owner=repo.owner,
            name=repo.name,
            full_name=repo.full_name,
            url=repo.url,
            description=repo.description,
            language=repo.language,
            stars=stars_map.get(int(repo.id)),
            stars_delta_7d=signals.get(SignalType.STARS_DELTA_7D),
            stars_delta_30d=signals.get(SignalType.STARS_DELTA_30D),
            velocity=signals.get(SignalType.VELOCITY),
            acceleration=signals.get(SignalType.ACCELERATION),
            trend=int(trend_val) if trend_val else None,
            forks_delta_7d=signals.get(SignalType.FORKS_DELTA_7D),
            forks_delta_30d=signals.get(SignalType.FORKS_DELTA_30D),
            issues_delta_7d=signals.get(SignalType.ISSUES_DELTA_7D),
            issues_delta_30d=signals.get(SignalType.ISSUES_DELTA_30D),
            rank=rank,
        ))

    trends_response = TrendsResponse(
        repos=trending_repos,
        total=len(trending_repos),
        sort_by=sort_by.value,
    )
    return success_response(
        data=trends_response,
        message=f"Found {len(trending_repos)} trending repositories (sorted by {sort_by.value})"
    )
