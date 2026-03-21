"""
對比圖表 API 端點。
提供多 Repo 星數趨勢資料，用於並排比較。
"""

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session
from sqlalchemy import asc

from constants import SignalType
from db.database import get_db
from db.models import Repo, RepoSnapshot
from schemas.response import ApiResponse, success_response
from services.queries import build_signal_map, build_snapshot_map
from utils.time import utc_today

router = APIRouter(prefix="/api/comparison", tags=["comparison"])

# 圖表線條預設色板
PALETTE = [
    "#2563eb",  # 藍
    "#dc2626",  # 紅
    "#16a34a",  # 綠
    "#ea580c",  # 橙
    "#9333ea",  # 紫
    "#0891b2",  # 青
    "#ca8a04",  # 黃
    "#e11d48",  # 玫瑰
]


class ComparisonRequest(BaseModel):
    repo_ids: list[int]
    time_range: str = "30d"
    normalize: bool = False

    @field_validator("repo_ids")
    @classmethod
    def validate_repo_ids(cls, v: list[int]) -> list[int]:
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
    open_issues: int | float


class ComparisonRepoData(BaseModel):
    repo_id: int
    repo_name: str
    color: str
    data_points: list[ChartDataPoint]
    current_stars: int
    velocity: float | None = None
    acceleration: float | None = None
    trend: int | None = None
    stars_delta_7d: int | None = None
    stars_delta_30d: int | None = None
    issues_delta_7d: int | None = None
    issues_delta_30d: int | None = None


class ComparisonChartResponse(BaseModel):
    repos: list[ComparisonRepoData]
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
    # 驗證所有 repo 存在
    repos = db.query(Repo).filter(Repo.id.in_(req.repo_ids)).all()
    repo_map = {r.id: r for r in repos}
    missing = [rid for rid in req.repo_ids if rid not in repo_map]
    if missing:
        raise HTTPException(status_code=404, detail=f"Repos not found: {missing}")

    # 計算日期範圍
    days_map = {"7d": 7, "30d": 30, "90d": 90}
    today = utc_today()
    if req.time_range == "all":
        start_date = None
    else:
        start_date = today - timedelta(days=days_map[req.time_range])

    # 一次查詢取得所有 repo 的快照
    snapshot_query = (
        db.query(RepoSnapshot)
        .filter(RepoSnapshot.repo_id.in_(req.repo_ids))
    )
    if start_date:
        snapshot_query = snapshot_query.filter(RepoSnapshot.snapshot_date >= start_date)
    snapshot_query = snapshot_query.order_by(asc(RepoSnapshot.snapshot_date))
    all_snapshots = snapshot_query.all()

    # 依 repo_id 分組
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
            open_issues: int | float = s.open_issues
            if req.normalize and snaps:
                base_stars = snaps[0].stars
                base_forks = snaps[0].forks
                base_issues = snaps[0].open_issues
                stars = round((s.stars - base_stars) / max(base_stars, 1) * 100, 2) if base_stars > 0 else 0
                forks = round((s.forks - base_forks) / max(base_forks, 1) * 100, 2) if base_forks > 0 else 0
                open_issues = round((s.open_issues - base_issues) / max(base_issues, 1) * 100, 2) if base_issues > 0 else 0
            data_points.append(ChartDataPoint(date=s.snapshot_date, stars=stars, forks=forks, open_issues=open_issues))

        sigs = signal_map.get(repo_id, {})
        latest = latest_map.get(repo_id)

        result_repos.append(ComparisonRepoData(
            repo_id=repo_id,
            repo_name=repo.full_name,
            color=PALETTE[i % len(PALETTE)],
            data_points=data_points,
            current_stars=latest.stars if latest else 0,
            velocity=round(sigs.get(SignalType.VELOCITY, 0), 2) if SignalType.VELOCITY in sigs else None,
            acceleration=round(sigs.get(SignalType.ACCELERATION, 0), 2) if SignalType.ACCELERATION in sigs else None,
            trend=int(sigs[SignalType.TREND]) if SignalType.TREND in sigs else None,
            stars_delta_7d=int(sigs[SignalType.STARS_DELTA_7D]) if SignalType.STARS_DELTA_7D in sigs else None,
            stars_delta_30d=int(sigs[SignalType.STARS_DELTA_30D]) if SignalType.STARS_DELTA_30D in sigs else None,
            issues_delta_7d=int(sigs[SignalType.ISSUES_DELTA_7D]) if SignalType.ISSUES_DELTA_7D in sigs else None,
            issues_delta_30d=int(sigs[SignalType.ISSUES_DELTA_30D]) if SignalType.ISSUES_DELTA_30D in sigs else None,
        ))

    chart_data = ComparisonChartResponse(
        repos=result_repos,
        time_range=req.time_range,
    )
    return success_response(data=chart_data)
