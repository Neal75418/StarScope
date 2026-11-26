"""
圖表資料 API 端點，用於趨勢視覺化。
提供前端圖表所需的歷史資料。
"""

from datetime import date, timedelta
from typing import Annotated, Literal, get_args

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Repo, RepoSnapshot
from schemas.response import ApiResponse, success_response
from utils.time import utc_today

router = APIRouter(prefix="/api/charts", tags=["charts"])

# 這支只收有天數的範圍：「全部」由 star-history 端點提供（同一張 RepoSnapshot 表、不限日期；回填過的 repo
# 含 GitHub 上的歷史），這裡不再重複一個。型別只收這三個，OpenAPI 才不會把 all 列成合法值，送了也和其他
# 不合法的值一樣回 422。用字串 Literal 不用 TimeRange 的成員：後者的 422 訊息會列出 <TimeRange.WEEK: '7d'>
ChartTimeRange = Literal["7d", "30d", "90d"]
_DAYS: dict[ChartTimeRange, int] = {"7d": 7, "30d": 30, "90d": 90}
assert set(_DAYS) == set(get_args(ChartTimeRange))


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
    data_points: list[ChartDataPoint]
    min_stars: int
    max_stars: int


@router.get("/{repo_id}/stars", response_model=ApiResponse[StarsChartResponse])
def get_stars_chart(
    repo_id: int,
    db: Annotated[Session, Depends(get_db)],
    time_range: Annotated[ChartTimeRange, Query(description="Time range for chart data")] = "30d",
) -> dict:
    """
    取得圖表用的歷史 star 數資料。
    回傳指定時間範圍的資料點。
    """
    repo = db.query(Repo).filter(Repo.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    start_date = utc_today() - timedelta(days=_DAYS[time_range])

    # 抓取日期範圍內的快照
    snapshots = (
        db.query(RepoSnapshot)
        .filter(
            RepoSnapshot.repo_id == repo_id,
            RepoSnapshot.snapshot_date >= start_date
        )
        .order_by(RepoSnapshot.snapshot_date.asc())
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
        time_range=time_range,
        data_points=data_points,
        min_stars=min_stars,
        max_stars=max_stars,
    )
    return success_response(data=chart_data)
