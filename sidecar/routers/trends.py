"""
Trends API endpoints for viewing repos sorted by various metrics.
"""

from typing import List, Optional
from enum import Enum

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import desc

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


def get_signal_value(db: Session, repo_id: int, signal_type: str) -> Optional[float]:
    """Get the latest signal value for a repo."""
    signal = (
        db.query(Signal)
        .filter(Signal.repo_id == repo_id, Signal.signal_type == signal_type)
        .order_by(desc(Signal.calculated_at))
        .first()
    )
    return signal.value if signal else None


def get_latest_stars(db: Session, repo_id: int) -> Optional[int]:
    """Get the latest star count from snapshots."""
    from db.models import RepoSnapshot
    snapshot = (
        db.query(RepoSnapshot)
        .filter(RepoSnapshot.repo_id == repo_id)
        .order_by(desc(RepoSnapshot.snapshot_date))
        .first()
    )
    return snapshot.stars if snapshot else None


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
    # Get all repos with their signals
    repos = db.query(Repo).all()

    # Build list with metrics
    repo_metrics = []
    for repo in repos:
        stars_delta_7d = get_signal_value(db, repo.id, SignalType.STARS_DELTA_7D)
        stars_delta_30d = get_signal_value(db, repo.id, SignalType.STARS_DELTA_30D)
        velocity = get_signal_value(db, repo.id, SignalType.VELOCITY)
        acceleration = get_signal_value(db, repo.id, SignalType.ACCELERATION)
        trend = get_signal_value(db, repo.id, SignalType.TREND)
        stars = get_latest_stars(db, repo.id)

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
