"""
Context signals API endpoints.
Provides context information about why a repo is trending (HN, Reddit, Releases).
"""

from typing import List, Optional
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import desc

from db.database import get_db
from db.models import ContextSignal, ContextSignalType
from routers.dependencies import get_repo_or_404
from services.context_fetcher import fetch_context_signals_for_repo
from utils.time import utc_now
from constants import MIN_HN_SCORE_FOR_BADGE, MIN_REDDIT_SCORE_FOR_BADGE, RECENT_THRESHOLD_DAYS

router = APIRouter(prefix="/context", tags=["context"])


# Response schemas
class ContextSignalResponse(BaseModel):
    """Schema for a context signal."""
    id: int
    signal_type: str
    external_id: str
    title: str
    url: str
    score: Optional[int]
    comment_count: Optional[int]
    author: Optional[str]
    version_tag: Optional[str]
    is_prerelease: Optional[bool]
    published_at: Optional[datetime]
    fetched_at: datetime

    class Config:
        from_attributes = True


class ContextSignalsResponse(BaseModel):
    """Response for context signals list."""
    signals: List[ContextSignalResponse]
    total: int
    repo_id: int


class ContextBadge(BaseModel):
    """A badge to display on repo card."""
    type: str  # "hn", "reddit", "release"
    label: str  # "HN: 150 pts", "Reddit: 200 upvotes", "Release v2.0"
    url: str
    score: Optional[int]
    is_recent: bool  # Published within last 7 days


class ContextBadgesResponse(BaseModel):
    """Response for context badges."""
    badges: List[ContextBadge]
    repo_id: int


class FetchContextResponse(BaseModel):
    """Response for manual context fetch."""
    repo_id: int
    new_signals: dict


# Endpoints
@router.get("/{repo_id}/signals", response_model=ContextSignalsResponse)
async def get_context_signals(
    repo_id: int,
    signal_type: Optional[str] = Query(None, description="Filter by signal type (hacker_news, reddit, github_release)"),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """
    Get all context signals for a repository.
    """
    get_repo_or_404(repo_id, db)

    query = db.query(ContextSignal).filter(ContextSignal.repo_id == repo_id)

    if signal_type:
        # Validate signal type
        valid_types = [ContextSignalType.HACKER_NEWS, ContextSignalType.REDDIT, ContextSignalType.GITHUB_RELEASE]
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
    Get context badges for a repository.
    Returns the most relevant badges to display on the repo card.
    Only returns badges that meet the score threshold.
    """
    get_repo_or_404(repo_id, db)

    badges: List[ContextBadge] = []
    recent_threshold = utc_now() - timedelta(days=RECENT_THRESHOLD_DAYS)

    def _is_recent(published_at: Optional[datetime]) -> bool:
        """Check if a datetime is recent, handling timezone-naive datetimes."""
        if not published_at:
            return False
        # Handle timezone-naive datetimes from DB
        if published_at.tzinfo is None:
            published_at = published_at.replace(tzinfo=timezone.utc)
        return published_at > recent_threshold

    # Get top HN story (by score)
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

    # Get top Reddit post (by score)
    top_reddit = (
        db.query(ContextSignal)
        .filter(
            ContextSignal.repo_id == repo_id,
            ContextSignal.signal_type == ContextSignalType.REDDIT
        )
        .order_by(desc(ContextSignal.score))
        .first()
    )
    if top_reddit and top_reddit.score and top_reddit.score >= MIN_REDDIT_SCORE_FOR_BADGE:
        badges.append(ContextBadge(
            type="reddit",
            label=f"Reddit: {top_reddit.score}",
            url=top_reddit.url,
            score=top_reddit.score,
            is_recent=_is_recent(top_reddit.published_at),
        ))

    # Get latest release (always show if exists)
    latest_release = (
        db.query(ContextSignal)
        .filter(
            ContextSignal.repo_id == repo_id,
            ContextSignal.signal_type == ContextSignalType.GITHUB_RELEASE
        )
        .order_by(desc(ContextSignal.published_at))
        .first()
    )
    if latest_release and latest_release.version_tag:
        badges.append(ContextBadge(
            type="release",
            label=f"Release {latest_release.version_tag}",
            url=latest_release.url,
            score=None,
            is_recent=_is_recent(latest_release.published_at),
        ))

    return ContextBadgesResponse(badges=badges, repo_id=repo_id)


@router.post("/{repo_id}/fetch", response_model=FetchContextResponse)
async def fetch_repo_context(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    Manually trigger context signal fetch for a repository.
    Fetches from HN, Reddit, and GitHub Releases.
    """
    repo = get_repo_or_404(repo_id, db)

    hn_count, reddit_count, release_count = await fetch_context_signals_for_repo(repo, db)

    return FetchContextResponse(
        repo_id=repo_id,
        new_signals={
            "hacker_news": hn_count,
            "reddit": reddit_count,
            "releases": release_count,
        }
    )
