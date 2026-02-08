"""
情境訊號 API 端點。
提供 repo 為何趨勢上升的情境資訊（僅 HN）。
"""

from typing import Dict, List, Optional
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import desc, func

from db.database import get_db
from constants import ContextSignalType
from db.models import ContextSignal
from routers.dependencies import get_repo_or_404
from services.context_fetcher import fetch_context_signals_for_repo
from utils.time import utc_now
from constants import MIN_HN_SCORE_FOR_BADGE, RECENT_THRESHOLD_DAYS

router = APIRouter(prefix="/context", tags=["context"])


# 回應 schema
class ContextSignalResponse(BaseModel):
    """情境訊號的 schema。"""
    id: int
    signal_type: str
    external_id: str
    title: str
    url: str
    score: Optional[int]
    comment_count: Optional[int]
    author: Optional[str]
    published_at: Optional[datetime]
    fetched_at: datetime

    class Config:
        from_attributes = True


class ContextSignalsResponse(BaseModel):
    """情境訊號列表的回應。"""
    signals: List[ContextSignalResponse]
    total: int
    repo_id: int


class ContextBadge(BaseModel):
    """顯示在 repo 卡片上的徽章（僅 HN）。"""
    type: str  # "hn"
    label: str  # "HN: 150 pts"
    url: str
    score: Optional[int]
    is_recent: bool  # Published within last 7 days


class ContextBadgesResponse(BaseModel):
    """情境徽章的回應。"""
    badges: List[ContextBadge]
    repo_id: int


class BatchBadgesRequest(BaseModel):
    """批次取得徽章的請求。"""
    repo_ids: List[int]


class BatchBadgesResponse(BaseModel):
    """批次取得徽章的回應，key 為 repo_id 字串。"""
    results: Dict[str, ContextBadgesResponse]


class FetchContextResponse(BaseModel):
    """手動抓取情境的回應。"""
    repo_id: int
    new_signals: dict


# 端點
@router.get("/{repo_id}/signals", response_model=ContextSignalsResponse)
async def get_context_signals(
    repo_id: int,
    signal_type: Optional[str] = Query(None, description="Filter by signal type (hacker_news only)"),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """
    取得 repo 的所有情境訊號。
    僅支援 Hacker News 訊號。
    """
    get_repo_or_404(repo_id, db)

    query = db.query(ContextSignal).filter(ContextSignal.repo_id == repo_id)

    if signal_type:
        # 驗證訊號類型 — 目前僅支援 HN
        valid_types = [ContextSignalType.HACKER_NEWS]
        if signal_type not in valid_types:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid signal_type. Must be one of: {valid_types}"
            )
        query = query.filter(ContextSignal.signal_type == signal_type)

    signals = query.order_by(desc(ContextSignal.published_at)).limit(limit).all()

    return ContextSignalsResponse(
        signals=[ContextSignalResponse.model_validate(s) for s in signals],
        total=len(signals),
        repo_id=repo_id,
    )


@router.get("/{repo_id}/badges", response_model=ContextBadgesResponse)
async def get_context_badges(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    取得 repo 的情境徽章。
    回傳顯示在 repo 卡片上的 HN 徽章。
    僅回傳達到分數門檻的徽章。
    """
    get_repo_or_404(repo_id, db)

    badges: List[ContextBadge] = []
    recent_threshold = utc_now() - timedelta(days=RECENT_THRESHOLD_DAYS)

    def _is_recent(published_at: Optional[datetime]) -> bool:
        """檢查 datetime 是否為近期，處理無時區的 datetime。"""
        if not published_at:
            return False
        # 處理 DB 中無時區的 datetime
        if published_at.tzinfo is None:
            published_at = published_at.replace(tzinfo=timezone.utc)
        return published_at > recent_threshold

    # 取得分數最高的 HN 文章
    top_hn = (
        db.query(ContextSignal)
        .filter(
            ContextSignal.repo_id == repo_id,
            ContextSignal.signal_type == ContextSignalType.HACKER_NEWS
        )
        .order_by(desc(ContextSignal.score))
        .first()
    )
    if top_hn and top_hn.score and top_hn.score >= MIN_HN_SCORE_FOR_BADGE:
        badges.append(ContextBadge(
            type="hn",
            label=f"HN: {top_hn.score} pts",
            url=top_hn.url,
            score=top_hn.score,
            is_recent=_is_recent(top_hn.published_at),
        ))

    return ContextBadgesResponse(badges=badges, repo_id=repo_id)


@router.post("/{repo_id}/fetch", response_model=FetchContextResponse)
async def fetch_repo_context(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    手動觸發 repo 的情境訊號抓取。
    從 Hacker News 抓取。
    """
    repo = get_repo_or_404(repo_id, db)

    hn_count = await fetch_context_signals_for_repo(repo, db)

    return FetchContextResponse(
        repo_id=repo_id,
        new_signals={
            "hacker_news": hn_count,
        }
    )


@router.post("/badges/batch", response_model=BatchBadgesResponse)
async def get_context_badges_batch(
    request: BatchBadgesRequest,
    db: Session = Depends(get_db)
):
    """
    批次取得多個 repo 的情境徽章。
    用單一查詢取代 N 次個別請求。
    """
    repo_ids = request.repo_ids
    if not repo_ids:
        return BatchBadgesResponse(results={})

    recent_threshold = utc_now() - timedelta(days=RECENT_THRESHOLD_DAYS)

    def _is_recent(published_at: Optional[datetime]) -> bool:
        if not published_at:
            return False
        if published_at.tzinfo is None:
            published_at = published_at.replace(tzinfo=timezone.utc)
        return published_at > recent_threshold

    # 一次查詢所有 repo 的最高分 HN 文章（含 min(id) 作為同分 tiebreaker）
    from sqlalchemy import and_
    top_hn_subquery = db.query(
        ContextSignal.repo_id,
        func.max(ContextSignal.score).label("max_score"),
        func.min(ContextSignal.id).label("min_id")
    ).filter(
        ContextSignal.repo_id.in_(repo_ids),
        ContextSignal.signal_type == ContextSignalType.HACKER_NEWS
    ).group_by(ContextSignal.repo_id).subquery()

    top_signals = db.query(ContextSignal).join(
        top_hn_subquery,
        and_(
            ContextSignal.repo_id == top_hn_subquery.c.repo_id,
            ContextSignal.score == top_hn_subquery.c.max_score,
            ContextSignal.id == top_hn_subquery.c.min_id
        )
    ).all()

    # 組裝結果
    results: Dict[str, ContextBadgesResponse] = {}
    for signal in top_signals:
        if signal.score and signal.score >= MIN_HN_SCORE_FOR_BADGE:
            badge = ContextBadge(
                type="hn",
                label=f"HN: {signal.score} pts",
                url=signal.url,
                score=signal.score,
                is_recent=_is_recent(signal.published_at),
            )
            results[str(signal.repo_id)] = ContextBadgesResponse(
                badges=[badge], repo_id=signal.repo_id
            )

    # 沒有徽章的 repo 也要回傳空結果
    for rid in repo_ids:
        if str(rid) not in results:
            results[str(rid)] = ContextBadgesResponse(badges=[], repo_id=rid)

    return BatchBadgesResponse(results=results)
