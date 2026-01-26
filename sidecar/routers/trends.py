"""
Trends API endpoints for viewing repos sorted by various metrics.
"""

from typing import List, Optional
from enum import Enum

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import desc, func
from sqlalchemy.orm import Session, aliased

from db.database import get_db
from db.models import Repo, Signal, SignalType
from services.queries import build_signal_map, build_stars_map

router = APIRouter(prefix="/api/trends", tags=["trends"])


class SortBy(str, Enum):
    """Available sort options for trends."""
    VELOCITY = "velocity"
    STARS_DELTA_7D = "stars_delta_7d"
    STARS_DELTA_30D = "stars_delta_30d"
    ACCELERATION = "acceleration"


class TrendingRepo(BaseModel):
    """A repo with its trending metrics."""
    id: int
    owner: str
    name: str
    full_name: str
    url: str
    description: Optional[str]
    language: Optional[str]
    stars: Optional[int]
    stars_delta_7d: Optional[float]
    stars_delta_30d: Optional[float]
    velocity: Optional[float]
    acceleration: Optional[float]
    trend: Optional[int]
    rank: int

    class Config:
        from_attributes = True


class TrendsResponse(BaseModel):
    """Response for trends list."""
    repos: List[TrendingRepo]
    total: int
    sort_by: str


def _get_signal_type_for_sort(sort_by: SortBy) -> str:
    """Map SortBy enum to SignalType."""
    return {
        SortBy.VELOCITY: SignalType.VELOCITY,
        SortBy.STARS_DELTA_7D: SignalType.STARS_DELTA_7D,
        SortBy.STARS_DELTA_30D: SignalType.STARS_DELTA_30D,
        SortBy.ACCELERATION: SignalType.ACCELERATION,
    }[sort_by]


@router.get("/", response_model=TrendsResponse)
async def get_trends(
    sort_by: SortBy = Query(SortBy.VELOCITY, description="Sort by which metric"),
    limit: int = Query(50, ge=1, le=100, description="Maximum number of results"),
    db: Session = Depends(get_db)
):
    """
    Get repos sorted by trending metrics.

    Available sort options:
    - velocity: Stars per day (7-day average)
    - stars_delta_7d: Stars gained in 7 days
    - stars_delta_30d: Stars gained in 30 days
    - acceleration: Rate of change in velocity
    """
    # Map sort_by to signal type
    sort_signal_type = _get_signal_type_for_sort(sort_by)

    # Create alias for sort signal to enable LEFT JOIN
    SortSignal = aliased(Signal)

    # Query repos with sort signal, sorted and limited in SQL
    # This avoids loading ALL repos into memory
    results = (
        db.query(Repo, SortSignal.value.label("sort_value"))
        .outerjoin(
            SortSignal,
            (Repo.id == SortSignal.repo_id) &
            (SortSignal.signal_type == sort_signal_type)
        )
        .order_by(desc(func.coalesce(SortSignal.value, 0)))
        .limit(limit)
        .all()
    )

    if not results:
        return TrendsResponse(repos=[], total=0, sort_by=sort_by.value)

    # Get repo IDs for batch fetching remaining data
    repo_ids = [repo.id for repo, _ in results]

    # Batch fetch signals and stars for only the limited result set
    signal_map = build_signal_map(db, repo_ids)
    stars_map = build_stars_map(db, repo_ids)

    # Build response with ranks
    trending_repos = []
    for rank, (repo, _) in enumerate(results, start=1):
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
            rank=rank,
        ))

    return TrendsResponse(
        repos=trending_repos,
        total=len(trending_repos),
        sort_by=sort_by.value,
    )


@router.get("/top-velocity", response_model=List[TrendingRepo])
async def get_top_velocity(
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db)
):
    """Get top repos by velocity (stars per day)."""
    response = await get_trends(sort_by=SortBy.VELOCITY, limit=limit, db=db)
    return response.repos


@router.get("/top-delta-7d", response_model=List[TrendingRepo])
async def get_top_delta_7d(
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db)
):
    """Get top repos by 7-day star delta."""
    response = await get_trends(sort_by=SortBy.STARS_DELTA_7D, limit=limit, db=db)
    return response.repos


@router.get("/top-acceleration", response_model=List[TrendingRepo])
async def get_top_acceleration(
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db)
):
    """Get top repos by acceleration (momentum change)."""
    response = await get_trends(sort_by=SortBy.ACCELERATION, limit=limit, db=db)
    return response.repos
