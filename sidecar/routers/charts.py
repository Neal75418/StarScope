"""
圖表資料 API 端點，用於趨勢視覺化。
提供前端圖表所需的歷史資料。
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
from schemas.response import ApiResponse, success_response
from utils.time import utc_today

router = APIRouter(prefix="/api/charts", tags=["charts"])


class TimeRange(str, Enum):
    """圖表的時間範圍選項。"""
    WEEK = "7d"
    MONTH = "30d"
    QUARTER = "90d"


class ChartDataPoint(BaseModel):
    """圖表的單一資料點。"""
    date: date
    stars: int
    forks: int


class StarsChartResponse(BaseModel):
    """Star 歷史圖表的回應。"""
    repo_id: int
    repo_name: str
    time_range: str
    data_points: List[ChartDataPoint]
    min_stars: int
    max_stars: int


@router.get("/{repo_id}/stars", response_model=ApiResponse[StarsChartResponse])
async def get_stars_chart(
    repo_id: int,
    time_range: TimeRange = Query(TimeRange.MONTH, description="Time range for chart data"),
    db: Session = Depends(get_db)
):
    """
    取得圖表用的歷史 star 數資料。
    回傳指定時間範圍的資料點。
    """
    repo = db.query(Repo).filter(Repo.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    # 計算日期範圍
    days_map = {
        TimeRange.WEEK: 7,
        TimeRange.MONTH: 30,
        TimeRange.QUARTER: 90,
    }
    days = days_map[time_range]
    start_date = utc_today() - timedelta(days=days)

    # 抓取日期範圍內的快照
    snapshots = (
        db.query(RepoSnapshot)
        .filter(
            RepoSnapshot.repo_id == repo_id,
            RepoSnapshot.snapshot_date >= start_date
        )
        .order_by(asc(RepoSnapshot.snapshot_date))
        .all()
    )

    # noinspection PyTypeChecker
    data_points = [
        ChartDataPoint(
            date=s.snapshot_date,
            stars=s.stars,
            forks=s.forks
        )
        for s in snapshots
    ]

    # 計算圖表縮放的最小/最大值
    if data_points:
        stars_values = [p.stars for p in data_points]
        min_stars = min(stars_values)
        max_stars = max(stars_values)
    else:
        min_stars = 0
        max_stars = 0

    # noinspection PyTypeChecker
    chart_data = StarsChartResponse(
        repo_id=repo_id,
        repo_name=repo.full_name,
        time_range=time_range.value,
        data_points=data_points,
        min_stars=min_stars,
        max_stars=max_stars,
    )
    return success_response(data=chart_data)
