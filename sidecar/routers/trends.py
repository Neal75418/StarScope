"""
趨勢 API 端點，依各種指標排序檢視 repo。
"""

from typing import List, Optional, cast
from enum import Enum

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import desc, func
from sqlalchemy.sql.elements import ColumnElement
from sqlalchemy.orm import Session, aliased

from db.database import get_db
from constants import SignalType
from db.models import Repo, RepoSnapshot, Signal
from services.queries import build_signal_map, build_stars_map
from schemas.response import ApiResponse, success_response

router = APIRouter(prefix="/api/trends", tags=["trends"])


class SortBy(str, Enum):
    """趨勢的可用排序選項。"""
    VELOCITY = "velocity"
    STARS_DELTA_7D = "stars_delta_7d"
    STARS_DELTA_30D = "stars_delta_30d"
    ACCELERATION = "acceleration"


class TrendingRepo(BaseModel):
    """含趨勢指標的 repo。"""
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
    """趨勢列表的回應。"""
    repos: List[TrendingRepo]
    total: int
    sort_by: str


def _get_signal_type_for_sort(sort_by: SortBy) -> str:
    """將 SortBy enum 映射為 SignalType。"""
    return {
        SortBy.VELOCITY: SignalType.VELOCITY,
        SortBy.STARS_DELTA_7D: SignalType.STARS_DELTA_7D,
        SortBy.STARS_DELTA_30D: SignalType.STARS_DELTA_30D,
        SortBy.ACCELERATION: SignalType.ACCELERATION,
    }[sort_by]


@router.get("/", response_model=ApiResponse[TrendsResponse])
async def get_trends(
    sort_by: SortBy = Query(SortBy.VELOCITY, description="Sort by which metric"),
    limit: int = Query(50, ge=1, le=100, description="Maximum number of results"),
    language: Optional[str] = Query(None, description="Filter by programming language"),
    min_stars: Optional[int] = Query(None, ge=0, description="Minimum star count"),
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
    # 將 sort_by 映射為訊號類型
    sort_signal_type = _get_signal_type_for_sort(sort_by)

    # 為排序訊號建立別名以啟用 LEFT JOIN
    sort_signal = aliased(Signal)
    sort_value = cast(ColumnElement, cast(object, sort_signal.value)).label("sort_value")

    # 在 SQL 中查詢 repo 並排序、限制
    # 避免將所有 repo 載入記憶體
    # noinspection PyTypeChecker
    query = (
        db.query(Repo, sort_value)
        .outerjoin(
            sort_signal,
            (Repo.id == sort_signal.repo_id) &
            (sort_signal.signal_type == sort_signal_type)
        )
    )

    # 語言篩選
    if language:
        query = query.filter(func.lower(Repo.language) == language.lower())

    # 最低 star 數篩選（透過最新快照的 stars 欄位）
    if min_stars is not None:
        query = query.filter(
            db.query(RepoSnapshot.id)
            .filter(
                RepoSnapshot.repo_id == Repo.id,
                RepoSnapshot.stars >= min_stars
            ).exists()
        )

    results = (
        query
        .order_by(desc(func.coalesce(sort_signal.value, 0)))
        .limit(limit)
        .all()
    )

    if not results:
        empty_response = TrendsResponse(repos=[], total=0, sort_by=sort_by.value)
        return success_response(
            data=empty_response,
            message=f"No trending repositories found (sorted by {sort_by.value})"
        )

    # 取得 repo ID 以批次抓取剩餘資料
    repo_ids = [repo.id for repo, _ in results]

    # 僅為限制後的結果集批次抓取訊號與 star 數
    signal_map = build_signal_map(db, repo_ids)
    stars_map = build_stars_map(db, repo_ids)

    # 建立含排名的回應
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

    trends_response = TrendsResponse(
        repos=trending_repos,
        total=len(trending_repos),
        sort_by=sort_by.value,
    )
    return success_response(
        data=trends_response,
        message=f"Found {len(trending_repos)} trending repositories (sorted by {sort_by.value})"
    )


@router.get("/top-velocity", response_model=ApiResponse[TrendsResponse])
async def get_top_velocity(
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db)
) -> dict:
    """依 velocity（每日 star 數）取得排名前列的 repo。"""
    return await get_trends(sort_by=SortBy.VELOCITY, limit=limit, db=db)


@router.get("/top-delta-7d", response_model=ApiResponse[TrendsResponse])
async def get_top_delta_7d(
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db)
) -> dict:
    """依 7 天 star 增量取得排名前列的 repo。"""
    return await get_trends(sort_by=SortBy.STARS_DELTA_7D, limit=limit, db=db)


@router.get("/top-acceleration", response_model=ApiResponse[TrendsResponse])
async def get_top_acceleration(
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db)
) -> dict:
    """依 acceleration（動量變化）取得排名前列的 repo。"""
    return await get_trends(sort_by=SortBy.ACCELERATION, limit=limit, db=db)
