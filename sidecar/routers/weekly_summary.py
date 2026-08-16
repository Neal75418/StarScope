"""
每週摘要 API 端點。
為 Dashboard 提供彙整的每週資料。
"""

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db
from schemas.response import ApiResponse, success_response
from services.weekly_summary import get_weekly_summary

router = APIRouter(prefix="/api/summary", tags=["summary"])


class RepoSummary(BaseModel):
    repo_id: int
    full_name: str
    stars: int
    stars_delta_7d: int
    velocity: float
    trend: int


class HNMention(BaseModel):
    repo_id: int
    repo_name: str
    hn_title: str
    hn_score: int
    hn_url: str


class ReleaseItem(BaseModel):
    repo_id: int
    repo_name: str
    title: str
    url: str
    tags: list[str]
    published_at: str | None


class WeeklySummaryResponse(BaseModel):
    period_start: str
    period_end: str
    total_repos: int
    total_new_stars: int
    # 這個 response_model 會濾掉沒宣告的欄位。少宣告一個不會有任何錯誤訊息，
    # 前端只會收到「欄位不存在」——而 repos_compared 不存在時的預設行為
    # 正好跟它為 0 一樣，所以整條鏈看起來是對的，實際上永遠停在同一個分支。
    repos_compared: int
    top_gainers: list[RepoSummary]
    top_losers: list[RepoSummary]
    alerts_triggered: int
    early_signals_detected: int
    early_signals_by_type: dict[str, int]
    hn_mentions: list[HNMention]
    releases: list[ReleaseItem]
    accelerating: int
    decelerating: int


@router.get("/weekly", response_model=ApiResponse[WeeklySummaryResponse])
async def weekly_summary(
    days: int = Query(default=7, ge=7, le=30),
    db: Session = Depends(get_db),
) -> dict:
    """
    取得摘要，包含：
    - 所有 repo 指定天數內新增 stars 總和
    - Top gainers / losers
    - 指定期間觸發的警報與早期信號
    - HN 提及
    - 本週發布的新版本
    - 加速/減速 repo 統計

    Args:
        days: 摘要涵蓋的天數（預設 7 天，最多 30 天）
    """
    data = get_weekly_summary(db, days=days)
    return success_response(data=data)
