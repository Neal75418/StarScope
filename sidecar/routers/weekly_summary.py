"""
Weekly summary API endpoint.
Provides aggregated weekly data for the Dashboard.
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


class WeeklySummaryResponse(BaseModel):
    period_start: str
    period_end: str
    total_repos: int
    total_new_stars: int
    top_gainers: list[RepoSummary]
    top_losers: list[RepoSummary]
    alerts_triggered: int
    early_signals_detected: int
    early_signals_by_type: dict[str, int]
    hn_mentions: list[HNMention]
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
    - 加速/減速 repo 統計

    Args:
        days: 摘要涵蓋的天數（預設 7 天，最多 30 天）
    """
    data = get_weekly_summary(db, days=days)
    return success_response(data=data)
