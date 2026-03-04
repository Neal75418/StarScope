"""
Comparison chart API endpoint.
Provides multi-repo star trend data for side-by-side comparison.
"""

from typing import List, Optional
from datetime import date, timedelta
from enum import Enum

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session
from sqlalchemy import asc

from db.database import get_db
from db.models import Repo, RepoSnapshot
from schemas.response import ApiResponse, success_response
from services.queries import build_signal_map, build_snapshot_map
from utils.time import utc_today

router = APIRouter(prefix="/api/comparison", tags=["comparison"])

# Pre-defined color palette for chart lines
PALETTE = [
    "#2563eb",  # blue
    "#dc2626",  # red
    "#16a34a",  # green
    "#ea580c",  # orange
    "#9333ea",  # purple
    "#0891b2",  # cyan
    "#ca8a04",  # yellow
    "#e11d48",  # rose
]


class TimeRange(str, Enum):
    WEEK = "7d"
    MONTH = "30d"
    QUARTER = "90d"
    ALL = "all"


class ComparisonRequest(BaseModel):
    repo_ids: List[int]
    time_range: str = "30d"
    normalize: bool = False

    @field_validator("repo_ids")
    @classmethod
    def validate_repo_ids(cls, v: List[int]) -> List[int]:
        if len(v) < 2:
            raise ValueError("At least 2 repos required")
        if len(v) > 5:
            raise ValueError("At most 5 repos allowed")
        if len(set(v)) != len(v):
            raise ValueError("Duplicate repo IDs not allowed")
        return v

    @field_validator("time_range")
    @classmethod
    def validate_time_range(cls, v: str) -> str:
        if v not in ("7d", "30d", "90d", "all"):
            raise ValueError("time_range must be 7d, 30d, 90d, or all")
        return v


class ChartDataPoint(BaseModel):
    date: date
    stars: int | float
    forks: int | float


class ComparisonRepoData(BaseModel):
    repo_id: int
    repo_name: str
    color: str
    data_points: List[ChartDataPoint]
    current_stars: int
    velocity: Optional[float] = None
    acceleration: Optional[float] = None
    trend: Optional[int] = None
    stars_delta_7d: Optional[int] = None
    stars_delta_30d: Optional[int] = None


class ComparisonChartResponse(BaseModel):
    repos: List[ComparisonRepoData]
    time_range: str


@router.post("/chart", response_model=ApiResponse[ComparisonChartResponse])
async def comparison_chart(
    req: ComparisonRequest,
    db: Session = Depends(get_db),
):
    """
    取得多個 repo 的對比圖表資料。
    支援 2-5 個 repo，可選正規化為百分比變化。
    """
    # Verify all repos exist
    repos = db.query(Repo).filter(Repo.id.in_(req.repo_ids)).all()
    repo_map = {r.id: r for r in repos}
    missing = [rid for rid in req.repo_ids if rid not in repo_map]
    if missing:
        raise HTTPException(status_code=404, detail=f"Repos not found: {missing}")

    # Calculate date range
    days_map = {"7d": 7, "30d": 30, "90d": 90}
    today = utc_today()
    if req.time_range == "all":
        start_date = None
    else:
        start_date = today - timedelta(days=days_map[req.time_range])

    # Fetch snapshots for all repos in one query
    snapshot_query = (
        db.query(RepoSnapshot)
        .filter(RepoSnapshot.repo_id.in_(req.repo_ids))
    )
    if start_date:
        snapshot_query = snapshot_query.filter(RepoSnapshot.snapshot_date >= start_date)
    snapshot_query = snapshot_query.order_by(asc(RepoSnapshot.snapshot_date))
    all_snapshots = snapshot_query.all()

    # Group by repo_id
    snapshots_by_repo: dict[int, list[RepoSnapshot]] = {rid: [] for rid in req.repo_ids}
    for s in all_snapshots:
        snapshots_by_repo[s.repo_id].append(s)

    # Pre-fetch signals and latest snapshots
    signal_map = build_signal_map(db, req.repo_ids)
    latest_map = build_snapshot_map(db, req.repo_ids)

    result_repos: list[ComparisonRepoData] = []
    for i, repo_id in enumerate(req.repo_ids):
        repo = repo_map[repo_id]
        snaps = snapshots_by_repo[repo_id]

        data_points: list[ChartDataPoint] = []
        for s in snaps:
            stars: int | float = s.stars
            forks: int | float = s.forks
            if req.normalize and snaps:
                base = snaps[0].stars
                if base > 0:
                    stars = round((s.stars - base) / base * 100, 2)
                    forks = round((s.forks - snaps[0].forks) / max(snaps[0].forks, 1) * 100, 2)
                else:
                    stars = 0
                    forks = 0
            data_points.append(ChartDataPoint(date=s.snapshot_date, stars=stars, forks=forks))

        sigs = signal_map.get(repo_id, {})
        latest = latest_map.get(repo_id)

        result_repos.append(ComparisonRepoData(
            repo_id=repo_id,
            repo_name=repo.full_name,
            color=PALETTE[i % len(PALETTE)],
            data_points=data_points,
            current_stars=latest.stars if latest else 0,
            velocity=round(sigs.get("star_velocity", 0), 2) if "star_velocity" in sigs else None,
            acceleration=round(sigs.get("acceleration", 0), 2) if "acceleration" in sigs else None,
            trend=int(sigs["trend"]) if "trend" in sigs else None,
            stars_delta_7d=int(sigs["stars_delta_7d"]) if "stars_delta_7d" in sigs else None,
            stars_delta_30d=int(sigs["stars_delta_30d"]) if "stars_delta_30d" in sigs else None,
        ))

    chart_data = ComparisonChartResponse(
        repos=result_repos,
        time_range=req.time_range,
    )
    return success_response(data=chart_data)
