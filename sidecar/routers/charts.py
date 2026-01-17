"""
Chart data API endpoints for trend visualization.
Provides historical data for frontend charts.
"""

from typing import List
from datetime import date, timedelta
from enum import Enum

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import asc

from db.database import get_db
from db.models import Repo, RepoSnapshot
from utils.time import utc_today

router = APIRouter(prefix="/charts", tags=["charts"])


class TimeRange(str, Enum):
    """Time range options for charts."""
    WEEK = "7d"
    MONTH = "30d"
    QUARTER = "90d"


class ChartDataPoint(BaseModel):
    """A single data point for charts."""
    date: date
    stars: int
    forks: int


class StarsChartResponse(BaseModel):
    """Response for star history chart."""
    repo_id: int
    repo_name: str
    time_range: str
    data_points: List[ChartDataPoint]
    min_stars: int
    max_stars: int


@router.get("/{repo_id}/stars", response_model=StarsChartResponse)
async def get_stars_chart(
    repo_id: int,
    time_range: TimeRange = Query(TimeRange.MONTH, description="Time range for chart data"),
    db: Session = Depends(get_db)
):
    """
    Get historical star count data for charting.
    Returns data points for the specified time range.
    """
    repo = db.query(Repo).filter(Repo.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    # Calculate date range
    days_map = {
        TimeRange.WEEK: 7,
        TimeRange.MONTH: 30,
        TimeRange.QUARTER: 90,
    }
    days = days_map[time_range]
    start_date = utc_today() - timedelta(days=days)

    # Fetch snapshots in date range
    snapshots = (
        db.query(RepoSnapshot)
        .filter(
            RepoSnapshot.repo_id == repo_id,
            RepoSnapshot.snapshot_date >= start_date
        )
        .order_by(asc(RepoSnapshot.snapshot_date))
        .all()
    )

    data_points = [
        ChartDataPoint(
            date=s.snapshot_date,
            stars=s.stars,
            forks=s.forks
        )
        for s in snapshots
    ]

    # Calculate min/max for chart scaling
    if data_points:
        stars_values = [p.stars for p in data_points]
        min_stars = min(stars_values)
        max_stars = max(stars_values)
    else:
        min_stars = 0
        max_stars = 0

    return StarsChartResponse(
        repo_id=repo_id,
        repo_name=repo.full_name,
        time_range=time_range.value,
        data_points=data_points,
        min_stars=min_stars,
        max_stars=max_stars,
    )
