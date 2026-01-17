"""
Trends API endpoints for viewing repos sorted by various metrics.
"""

from typing import List, Optional
from enum import Enum

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Repo, Signal, SignalType

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


def _build_signal_map(db: Session) -> dict[int, dict[str, float]]:
    """
    Pre-fetch all signals and group by repo_id.
    Returns: {repo_id: {signal_type: value}}
    """
    all_signals = db.query(Signal).all()
    signal_map: dict[int, dict[str, float]] = {}

    for signal in all_signals:
        if signal.repo_id not in signal_map:
            signal_map[signal.repo_id] = {}
        signal_map[signal.repo_id][signal.signal_type] = signal.value

    return signal_map


def _build_stars_map(db: Session) -> dict[int, int]:
    """
    Pre-fetch latest snapshot stars for all repos.
    Returns: {repo_id: stars}
    """
    from db.models import RepoSnapshot
    from sqlalchemy import func

    # Subquery to get max snapshot_date per repo
    subq = (
        db.query(
            RepoSnapshot.repo_id,
            func.max(RepoSnapshot.snapshot_date).label("max_date")
        )
        .group_by(RepoSnapshot.repo_id)
        .subquery()
    )

    # Join to get stars from latest snapshot
    results = (
        db.query(RepoSnapshot.repo_id, RepoSnapshot.stars)
        .join(
            subq,
            (RepoSnapshot.repo_id == subq.c.repo_id) &
            (RepoSnapshot.snapshot_date == subq.c.max_date)
        )
        .all()
    )

    return {repo_id: stars for repo_id, stars in results}


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
    # Pre-fetch all data in batch queries (fixes N+1 problem)
    repos = db.query(Repo).all()
    signal_map = _build_signal_map(db)
    stars_map = _build_stars_map(db)

    # Build list with metrics
    repo_metrics = []
    for repo in repos:
        signals = signal_map.get(repo.id, {})
        stars_delta_7d = signals.get(SignalType.STARS_DELTA_7D)
        stars_delta_30d = signals.get(SignalType.STARS_DELTA_30D)
        velocity = signals.get(SignalType.VELOCITY)
        acceleration = signals.get(SignalType.ACCELERATION)
        trend = signals.get(SignalType.TREND)
        stars = stars_map.get(repo.id)

        # Get sort value
        sort_value = {
            SortBy.VELOCITY: velocity,
            SortBy.STARS_DELTA_7D: stars_delta_7d,
            SortBy.STARS_DELTA_30D: stars_delta_30d,
            SortBy.ACCELERATION: acceleration,
        }.get(sort_by, 0) or 0

        repo_metrics.append({
            "repo": repo,
            "stars": stars,
            "stars_delta_7d": stars_delta_7d,
            "stars_delta_30d": stars_delta_30d,
            "velocity": velocity,
            "acceleration": acceleration,
            "trend": int(trend) if trend else None,
            "sort_value": sort_value,
        })

    # Sort by the chosen metric (descending)
    repo_metrics.sort(key=lambda x: x["sort_value"], reverse=True)

    # Limit results
    repo_metrics = repo_metrics[:limit]

    # Build response with ranks
    trending_repos = []
    for rank, item in enumerate(repo_metrics, start=1):
        repo = item["repo"]
        trending_repos.append(TrendingRepo(
            id=repo.id,
            owner=repo.owner,
            name=repo.name,
            full_name=repo.full_name,
            url=repo.url,
            description=repo.description,
            language=repo.language,
            stars=item["stars"],
            stars_delta_7d=item["stars_delta_7d"],
            stars_delta_30d=item["stars_delta_30d"],
            velocity=item["velocity"],
            acceleration=item["acceleration"],
            trend=item["trend"],
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
