"""
Health score API endpoints.
Provides project health scoring for repositories.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Repo, HealthScore, Signal, SignalType
from routers.dependencies import get_repo_or_404
from services.health_scorer import calculate_health_score, HealthScoreResult
from utils.time import utc_now

router = APIRouter(prefix="/health-score", tags=["health-score"])


# Response schemas
class HealthMetricsResponse(BaseModel):
    """Raw health metrics."""
    avg_issue_response_hours: Optional[float]
    pr_merge_rate: Optional[float]
    days_since_last_release: Optional[int]
    contributor_count: Optional[int]
    has_readme: Optional[bool]
    has_contributing: Optional[bool]
    has_license: Optional[bool]
    total_commits_52w: Optional[int]
    avg_commits_per_week: Optional[float]


class HealthScoreResponse(BaseModel):
    """Health score response."""
    repo_id: int
    repo_name: str
    overall_score: float
    grade: str

    # Individual scores
    issue_response_score: Optional[float]
    pr_merge_score: Optional[float]
    release_cadence_score: Optional[float]
    bus_factor_score: Optional[float]
    documentation_score: Optional[float]
    dependency_score: Optional[float]
    velocity_score: Optional[float]
    commit_activity_score: Optional[float]

    # Raw metrics
    metrics: Optional[HealthMetricsResponse]

    calculated_at: datetime

    class Config:
        from_attributes = True


class HealthScoreSummary(BaseModel):
    """Brief health score summary for badges."""
    repo_id: int
    overall_score: float
    grade: str
    calculated_at: datetime


# Helper functions
def _to_bool_or_none(value: Optional[int]) -> Optional[bool]:
    """Convert SQLite integer to bool, preserving None."""
    return bool(value) if value is not None else None


def _build_metrics_response(score: HealthScore) -> HealthMetricsResponse:
    """Build HealthMetricsResponse from HealthScore model."""
    return HealthMetricsResponse(
        avg_issue_response_hours=score.avg_issue_response_hours,
        pr_merge_rate=score.pr_merge_rate,
        days_since_last_release=score.days_since_last_release,
        contributor_count=score.contributor_count,
        has_readme=_to_bool_or_none(score.has_readme),
        has_contributing=_to_bool_or_none(score.has_contributing),
        has_license=_to_bool_or_none(score.has_license),
        total_commits_52w=score.total_commits_52w,
        avg_commits_per_week=score.avg_commits_per_week,
    )


def _build_response(repo: Repo, score: HealthScore) -> HealthScoreResponse:
    """Build HealthScoreResponse from Repo and HealthScore models."""
    return HealthScoreResponse(
        repo_id=repo.id,
        repo_name=repo.full_name,
        overall_score=score.overall_score,
        grade=score.grade,
        issue_response_score=score.issue_response_score,
        pr_merge_score=score.pr_merge_score,
        release_cadence_score=score.release_cadence_score,
        bus_factor_score=score.bus_factor_score,
        documentation_score=score.documentation_score,
        dependency_score=score.dependency_score,
        velocity_score=score.velocity_score,
        commit_activity_score=score.commit_activity_score,
        metrics=_build_metrics_response(score),
        calculated_at=score.calculated_at,
    )


def _calculate_pr_merge_rate(result: HealthScoreResult) -> Optional[float]:
    """Calculate PR merge rate percentage from metrics."""
    if not result.metrics:
        return None
    total = result.metrics.merged_prs_count + result.metrics.closed_prs_count
    if total == 0:
        return None
    return (result.metrics.merged_prs_count / total) * 100


def _update_health_score(score: HealthScore, result: HealthScoreResult) -> None:
    """Update HealthScore model with calculation result."""
    score.overall_score = result.overall_score
    score.grade = result.grade
    score.issue_response_score = result.issue_response_score
    score.pr_merge_score = result.pr_merge_score
    score.release_cadence_score = result.release_cadence_score
    score.bus_factor_score = result.bus_factor_score
    score.documentation_score = result.documentation_score
    score.dependency_score = result.dependency_score
    score.velocity_score = result.velocity_score
    score.commit_activity_score = result.commit_activity_score
    score.avg_issue_response_hours = result.metrics.avg_issue_response_hours if result.metrics else None
    score.pr_merge_rate = _calculate_pr_merge_rate(result)
    score.days_since_last_release = result.metrics.days_since_last_release if result.metrics else None
    score.contributor_count = result.metrics.contributor_count if result.metrics else None
    score.has_readme = result.metrics.has_readme if result.metrics else None
    score.has_contributing = result.metrics.has_contributing if result.metrics else None
    score.has_license = result.metrics.has_license if result.metrics else None
    score.total_commits_52w = result.metrics.total_commits_52w if result.metrics else None
    score.avg_commits_per_week = result.metrics.avg_commits_per_week if result.metrics else None
    score.calculated_at = utc_now()


# Endpoints
@router.get("/{repo_id}", response_model=HealthScoreResponse)
async def get_health_score(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    Get the health score for a repository.
    Returns cached score if available.
    """
    repo = get_repo_or_404(repo_id, db)

    cached = db.query(HealthScore).filter(HealthScore.repo_id == repo_id).first()
    if cached:
        return _build_response(repo, cached)

    raise HTTPException(
        status_code=404,
        detail="Health score not calculated yet. Use POST to calculate."
    )


@router.post("/{repo_id}/calculate", response_model=HealthScoreResponse)
async def calculate_repo_health_score(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    Calculate (or recalculate) health score for a repository.
    """
    repo = get_repo_or_404(repo_id, db)

    # Get velocity from existing signals
    velocity_signal = db.query(Signal).filter(
        Signal.repo_id == repo_id,
        Signal.signal_type == SignalType.VELOCITY
    ).first()
    star_velocity = velocity_signal.value if velocity_signal else 0.0

    # Calculate health score
    result = await calculate_health_score(repo.owner, repo.name, star_velocity)

    if not result:
        raise HTTPException(
            status_code=503,
            detail="Failed to calculate health score. GitHub API may be unavailable."
        )

    # Store or update in database
    existing = db.query(HealthScore).filter(HealthScore.repo_id == repo_id).first()

    if existing:
        _update_health_score(existing, result)
        health_score = existing
    else:
        health_score = HealthScore(repo_id=repo_id)
        _update_health_score(health_score, result)
        db.add(health_score)

    db.commit()
    db.refresh(health_score)

    return _build_response(repo, health_score)


@router.get("/{repo_id}/summary", response_model=HealthScoreSummary)
async def get_health_score_summary(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    Get a brief health score summary (for badges).
    """
    get_repo_or_404(repo_id, db)

    cached = db.query(HealthScore).filter(HealthScore.repo_id == repo_id).first()

    if not cached:
        raise HTTPException(
            status_code=404,
            detail="Health score not calculated yet"
        )

    return HealthScoreSummary(
        repo_id=repo_id,
        overall_score=cached.overall_score,
        grade=cached.grade,
        calculated_at=cached.calculated_at,
    )
