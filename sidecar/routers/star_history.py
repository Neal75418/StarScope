"""
Star 歷史回填 API 端點。
提供 < 5000 stars 的 repo 歷史 star 資料回填。
"""

from collections import defaultdict
from datetime import datetime, date
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import RepoSnapshot
from routers.dependencies import get_repo_or_404
from schemas.response import ApiResponse, success_response
from services.github import get_github_service
from utils.time import utc_now

# 常數
MAX_STARS_FOR_BACKFILL = 5000
ERROR_TOO_MANY_STARS = f"Repository has too many stars (>{MAX_STARS_FOR_BACKFILL}). Backfill is not available."

router = APIRouter(prefix="/api/star-history", tags=["star-history"])


# 回應 schema
class BackfillStatus(BaseModel):
    """回填操作的狀態。"""
    repo_id: int
    repo_name: str
    can_backfill: bool
    current_stars: int
    max_stars_allowed: int
    has_backfilled_data: bool
    backfilled_days: int
    message: str


class BackfillResult(BaseModel):
    """回填操作的結果。"""
    repo_id: int
    repo_name: str
    success: bool
    total_stargazers: int
    snapshots_created: int
    earliest_date: Optional[str]  # ISO format date string
    latest_date: Optional[str]  # ISO format date string
    message: str


class StarHistoryPoint(BaseModel):
    """Star 歷史中的一個資料點。"""
    date: date
    stars: int


class StarHistoryResponse(BaseModel):
    """完整 star 歷史回應。"""
    repo_id: int
    repo_name: str
    history: List[StarHistoryPoint]
    is_backfilled: bool
    total_points: int


# 輔助函式
def _parse_starred_at(starred_at: str) -> Optional[date]:
    """將 ISO datetime 字串解析為 date。"""
    if not starred_at:
        return None
    try:
        return datetime.fromisoformat(starred_at.replace("Z", "+00:00")).date()
    except (ValueError, TypeError):
        return None


def _aggregate_stargazers_by_date(stargazers: List[dict]) -> dict[date, int]:
    """
    依日期彙總 stargazer，回傳每日累計 star 數。

    Args:
        stargazers: {"starred_at": "...", "user": {...}} 列表

    Returns:
        日期對應累計 star 數的字典
    """
    # 計算每日 star 數
    stars_per_day: dict[date, int] = defaultdict(int)

    for sg in stargazers:
        starred_at = sg.get("starred_at")
        star_date = _parse_starred_at(starred_at)
        if star_date:
            stars_per_day[star_date] += 1

    if not stars_per_day:
        return {}

    # 排序日期並計算累計數量
    sorted_dates = sorted(stars_per_day.keys())
    cumulative: dict[date, int] = {}
    running_total = 0

    for d in sorted_dates:
        running_total += stars_per_day[d]
        cumulative[d] = running_total

    return cumulative


def _create_snapshots_from_history(
    db: Session,
    repo_id: int,
    star_history: dict[date, int]
) -> int:
    """
    從 star 歷史建立或更新 RepoSnapshot 紀錄。
    回傳建立/更新的快照數量。
    """
    count = 0
    now = utc_now()

    try:
        # 一次查出該 repo 所有既有 snapshot，避免迴圈內逐一查詢（N+1）
        existing_snapshots = db.query(RepoSnapshot).filter(
            RepoSnapshot.repo_id == repo_id,
            RepoSnapshot.snapshot_date.in_(list(star_history.keys()))
        ).all()
        # noinspection PyTypeChecker
        existing_map = {s.snapshot_date: s for s in existing_snapshots}

        for snapshot_date, stars in star_history.items():
            # noinspection PyTypeChecker
            existing = existing_map.get(snapshot_date)

            if existing:
                # 若回填資料有更準確的 star 數則更新
                #（僅在回填數量較高時更新，表示我們有更完整的資料）
                if stars > existing.stars:
                    existing.stars = stars
                    existing.fetched_at = now
                    count += 1
            else:
                # 建立新快照
                snapshot = RepoSnapshot(
                    repo_id=repo_id,
                    stars=stars,
                    forks=0,  # Unknown for historical data
                    watchers=0,
                    open_issues=0,
                    snapshot_date=snapshot_date,
                    fetched_at=now,
                )
                db.add(snapshot)
                count += 1

        db.commit()
        return count
    except SQLAlchemyError:
        db.rollback()
        raise


# 端點
@router.get("/{repo_id}/status", response_model=ApiResponse[BackfillStatus])
async def get_backfill_status(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    檢查 repo 是否符合 star 歷史回填條件。
    """
    repo = get_repo_or_404(repo_id, db)

    # 從最新快照取得目前 star 數
    latest_snapshot = db.query(RepoSnapshot).filter(
        RepoSnapshot.repo_id == repo_id
    ).order_by(RepoSnapshot.snapshot_date.desc()).first()

    current_stars = latest_snapshot.stars if latest_snapshot else 0

    # 計算既有快照數量
    snapshot_count = db.query(RepoSnapshot).filter(
        RepoSnapshot.repo_id == repo_id
    ).count()

    can_backfill = current_stars <= MAX_STARS_FOR_BACKFILL
    has_data = snapshot_count > 1  # More than just today's snapshot

    if can_backfill:
        message = "Repository is eligible for star history backfill."
    else:
        message = f"Repository has {current_stars} stars, exceeding the {MAX_STARS_FOR_BACKFILL} limit."

    status_data = BackfillStatus(
        repo_id=repo.id,
        repo_name=repo.full_name,
        can_backfill=can_backfill,
        current_stars=current_stars,
        max_stars_allowed=MAX_STARS_FOR_BACKFILL,
        has_backfilled_data=has_data,
        backfilled_days=snapshot_count,
        message=message,
    )
    return success_response(data=status_data)


@router.post("/{repo_id}/backfill", response_model=ApiResponse[BackfillResult])
async def backfill_star_history(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    回填 repo 的 star 歷史。

    僅適用於 < 5000 stars 的 repo。
    抓取所有含時間戳記的 stargazer 並建立歷史快照。
    """
    repo = get_repo_or_404(repo_id, db)

    # GitHub 例外由 main.py 中的全域例外處理器處理。
    service = get_github_service()

    # 抓取含日期的 stargazer（包含 star 數檢查）
    stargazers = await service.get_stargazers_with_dates(
        repo.owner, repo.name, max_stars=MAX_STARS_FOR_BACKFILL
    )

    if not stargazers:
        # 無 star 或超過限制
        latest = db.query(RepoSnapshot).filter(
            RepoSnapshot.repo_id == repo_id
        ).order_by(RepoSnapshot.snapshot_date.desc()).first()

        current_stars = latest.stars if latest else 0

        if current_stars > MAX_STARS_FOR_BACKFILL:
            return success_response(data=BackfillResult(
                repo_id=repo.id,
                repo_name=repo.full_name,
                success=False,
                total_stargazers=0,
                snapshots_created=0,
                earliest_date=None,
                latest_date=None,
                message=ERROR_TOO_MANY_STARS,
            ))
        else:
            return success_response(data=BackfillResult(
                repo_id=repo.id,
                repo_name=repo.full_name,
                success=True,
                total_stargazers=0,
                snapshots_created=0,
                earliest_date=None,
                latest_date=None,
                message="No stargazers found.",
            ))

    # 依日期彙總
    star_history = _aggregate_stargazers_by_date(stargazers)

    if not star_history:
        return success_response(data=BackfillResult(
            repo_id=repo.id,
            repo_name=repo.full_name,
            success=True,
            total_stargazers=len(stargazers),
            snapshots_created=0,
            earliest_date=None,
            latest_date=None,
            message="Stargazers found but no valid dates.",
        ))

    # 建立快照
    snapshots_created = _create_snapshots_from_history(db, repo_id, star_history)

    sorted_dates = sorted(star_history.keys())

    # 處理未建立新快照的情況（所有既有快照的數量較高）
    if snapshots_created == 0:
        return success_response(data=BackfillResult(
            repo_id=repo.id,
            repo_name=repo.full_name,
            success=True,
            total_stargazers=len(stargazers),
            snapshots_created=0,
            earliest_date=None,
            latest_date=None,
            message="No new snapshots created - existing data is up to date.",
        ))

    return success_response(data=BackfillResult(
        repo_id=repo.id,
        repo_name=repo.full_name,
        success=True,
        total_stargazers=len(stargazers),
        snapshots_created=snapshots_created,
        earliest_date=sorted_dates[0].isoformat(),
        latest_date=sorted_dates[-1].isoformat(),
        message=f"Successfully backfilled {snapshots_created} days of star history.",
    ))


@router.get("/{repo_id}", response_model=ApiResponse[StarHistoryResponse])
async def get_star_history(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    取得 repo 的完整 star 歷史。
    回傳依日期排序的所有可用快照。
    """
    repo = get_repo_or_404(repo_id, db)

    snapshots = db.query(RepoSnapshot).filter(
        RepoSnapshot.repo_id == repo_id
    ).order_by(RepoSnapshot.snapshot_date.asc()).all()

    # noinspection PyTypeChecker
    history = [
        StarHistoryPoint(date=s.snapshot_date, stars=s.stars)
        for s in snapshots
    ]

    # 判斷資料是否已回填（有超過 30 天的資料）
    is_backfilled = False
    if history:
        oldest = history[0].date
        today = date.today()
        is_backfilled = (today - oldest).days > 30

    history_data = StarHistoryResponse(
        repo_id=repo.id,
        repo_name=repo.full_name,
        history=history,
        is_backfilled=is_backfilled,
        total_points=len(history),
    )
    return success_response(data=history_data)
