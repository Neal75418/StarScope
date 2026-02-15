"""
Commit 活動 API 端點。
提供 repo 每週 commit 活動資料。
"""

from datetime import datetime, date, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

from db.database import get_db
from db.models import Repo, CommitActivity
from routers.dependencies import get_repo_or_404
from services.github import get_github_service
from utils.time import utc_now

router = APIRouter(prefix="/api/commit-activity", tags=["commit-activity"])


# 回應 schema
class CommitWeekResponse(BaseModel):
    """每週 commit 資料。"""
    week_start: date
    commit_count: int


class CommitActivityResponse(BaseModel):
    """Commit 活動回應，含摘要統計。"""
    repo_id: int
    repo_name: str
    weeks: List[CommitWeekResponse]
    total_commits_52w: int
    avg_commits_per_week: float
    last_updated: Optional[datetime]


class CommitActivitySummary(BaseModel):
    """徽章/卡片用的簡短摘要。"""
    repo_id: int
    total_commits_52w: int
    avg_commits_per_week: float
    last_updated: Optional[datetime]


# 輔助函式
def _build_response(repo: Repo, activities: List[CommitActivity]) -> CommitActivityResponse:
    """從 repo 與活動紀錄建立 CommitActivityResponse。"""
    weeks = [
        CommitWeekResponse(week_start=a.week_start, commit_count=a.commit_count)
        for a in sorted(activities, key=lambda x: x.week_start)
    ]

    total = sum(a.commit_count for a in activities)
    avg = total / len(activities) if activities else 0.0
    last_updated = max((a.fetched_at for a in activities), default=None) if activities else None

    return CommitActivityResponse(
        repo_id=repo.id,
        repo_name=repo.full_name,
        weeks=weeks,
        total_commits_52w=total,
        avg_commits_per_week=round(avg, 2),
        last_updated=last_updated,
    )


def _store_commit_activity(
    db: Session,
    repo_id: int,
    github_data: List[dict]
) -> List[CommitActivity]:
    """
    儲存 GitHub API 回應中的 commit 活動資料。

    GitHub 回傳：[{week: timestamp, total: int, days: [int x 7]}, ...]
    """
    # 刪除此 repo 的既有資料（替換策略）
    db.query(CommitActivity).filter(CommitActivity.repo_id == repo_id).delete()

    activities = []
    now = utc_now()

    for week_data in github_data:
        # GitHub 回傳週起始的 Unix 時間戳記
        week_timestamp = week_data.get("week", 0)
        commit_count = week_data.get("total", 0)

        if week_timestamp > 0:
            # 使用 UTC 確保跨時區的日期一致
            week_start = datetime.fromtimestamp(week_timestamp, tz=timezone.utc).date()
            activity = CommitActivity(
                repo_id=repo_id,
                week_start=week_start,
                commit_count=commit_count,
                fetched_at=now,
            )
            activities.append(activity)

    db.add_all(activities)
    db.commit()

    return activities


# 端點
@router.get("/{repo_id}", response_model=CommitActivityResponse)
async def get_commit_activity(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    取得 repo 的已快取 commit 活動。
    尚未抓取時回傳 404。
    """
    repo = get_repo_or_404(repo_id, db)

    # noinspection PyTypeChecker
    activities: List[CommitActivity] = db.query(CommitActivity).filter(
        CommitActivity.repo_id == repo_id
    ).all()

    if not activities:
        raise HTTPException(
            status_code=404,
            detail="Commit activity not fetched yet. Use POST /fetch to retrieve from GitHub."
        )

    return _build_response(repo, activities)


@router.post("/{repo_id}/fetch", response_model=CommitActivityResponse)
async def fetch_commit_activity(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    從 GitHub 抓取（或重新整理）commit 活動。
    取代既有的快取資料。
    """
    repo = get_repo_or_404(repo_id, db)

    # GitHub 例外（NotFound、RateLimit、APIError）由
    # main.py 中註冊的全域例外處理器處理。
    service = get_github_service()
    github_data = await service.get_commit_activity(repo.owner, repo.name)

    if not github_data:
        # GitHub 對新 repo 可能回傳空資料
        return CommitActivityResponse(
            repo_id=repo.id,
            repo_name=repo.full_name,
            weeks=[],
            total_commits_52w=0,
            avg_commits_per_week=0.0,
            last_updated=utc_now(),
        )

    activities = _store_commit_activity(db, repo_id, github_data)
    return _build_response(repo, activities)


@router.get("/{repo_id}/summary", response_model=CommitActivitySummary)
async def get_commit_activity_summary(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    取得簡短的 commit 活動摘要（用於徽章/卡片）。
    """
    get_repo_or_404(repo_id, db)

    # 在資料庫中彙總以提高效率
    result = db.query(
        func.sum(CommitActivity.commit_count).label("total"),
        func.count(CommitActivity.id).label("weeks"),
        func.max(CommitActivity.fetched_at).label("last_updated"),
    ).filter(CommitActivity.repo_id == repo_id).first()

    if not result or result.total is None:
        raise HTTPException(
            status_code=404,
            detail="Commit activity not fetched yet"
        )

    total = result.total or 0
    weeks = result.weeks or 1
    avg = total / weeks if weeks > 0 else 0.0

    return CommitActivitySummary(
        repo_id=repo_id,
        total_commits_52w=total,
        avg_commits_per_week=round(avg, 2),
        last_updated=result.last_updated,
    )
