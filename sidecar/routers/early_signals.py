"""
Early Signals API endpoints.
Provides access to detected anomalies and early signals.
"""

from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

from db.database import get_db
from db.models import EarlySignal, Repo
from services.anomaly_detector import run_detection
from utils.time import utc_now

router = APIRouter(prefix="/early-signals", tags=["early-signals"])


# Response schemas
class EarlySignalResponse(BaseModel):
    """Schema for an early signal."""
    id: int
    repo_id: int
    repo_name: str
    signal_type: str
    severity: str
    description: str
    velocity_value: Optional[float]
    star_count: Optional[int]
    percentile_rank: Optional[float]
    detected_at: datetime
    expires_at: Optional[datetime]
    acknowledged: bool
    acknowledged_at: Optional[datetime]

    class Config:
        from_attributes = True


class EarlySignalListResponse(BaseModel):
    """Response for signal list."""
    signals: List[EarlySignalResponse]
    total: int


class SignalSummary(BaseModel):
    """Summary of signals by type and severity."""
    total_active: int
    by_type: dict
    by_severity: dict
    repos_with_signals: int


class DetectionResultResponse(BaseModel):
    """Response for detection run."""
    repos_scanned: int
    signals_detected: int
    by_type: dict


# Helper functions
def _signal_to_response(signal: EarlySignal) -> EarlySignalResponse:
    """Convert EarlySignal model to response."""
    return EarlySignalResponse(
        id=signal.id,
        repo_id=signal.repo_id,
        repo_name=signal.repo.full_name,
        signal_type=signal.signal_type,
        severity=signal.severity,
        description=signal.description,
        velocity_value=signal.velocity_value,
        star_count=signal.star_count,
        percentile_rank=signal.percentile_rank,
        detected_at=signal.detected_at,
        expires_at=signal.expires_at,
        acknowledged=bool(signal.acknowledged),
        acknowledged_at=signal.acknowledged_at,
    )


# Endpoints
@router.get("/", response_model=EarlySignalListResponse)
async def list_early_signals(
    signal_type: Optional[str] = Query(None, description="Filter by signal type"),
    severity: Optional[str] = Query(None, description="Filter by severity"),
    include_acknowledged: bool = Query(False, description="Include acknowledged signals"),
    include_expired: bool = Query(False, description="Include expired signals"),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db)
):
    """
    List all early signals.
    By default, only shows active, unacknowledged signals.
    """
    query = db.query(EarlySignal)

    if signal_type:
        query = query.filter(EarlySignal.signal_type == signal_type)

    if severity:
        query = query.filter(EarlySignal.severity == severity)

    if not include_acknowledged:
        query = query.filter(EarlySignal.acknowledged == False)

    if not include_expired:
        query = query.filter(
            (EarlySignal.expires_at == None) | (EarlySignal.expires_at > utc_now())
        )

    signals = query.order_by(
        EarlySignal.severity.desc(),  # High severity first
        EarlySignal.detected_at.desc()
    ).limit(limit).all()

    return EarlySignalListResponse(
        signals=[_signal_to_response(s) for s in signals],
        total=len(signals),
    )


@router.get("/repo/{repo_id}", response_model=EarlySignalListResponse)
async def get_repo_signals(
    repo_id: int,
    include_acknowledged: bool = Query(False),
    include_expired: bool = Query(False),
    db: Session = Depends(get_db)
):
    """
    Get early signals for a specific repository.
    """
    repo = db.query(Repo).filter(Repo.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    query = db.query(EarlySignal).filter(EarlySignal.repo_id == repo_id)

    if not include_acknowledged:
        query = query.filter(EarlySignal.acknowledged == False)

    if not include_expired:
        query = query.filter(
            (EarlySignal.expires_at == None) | (EarlySignal.expires_at > utc_now())
        )

    signals = query.order_by(EarlySignal.detected_at.desc()).all()

    return EarlySignalListResponse(
        signals=[_signal_to_response(s) for s in signals],
        total=len(signals),
    )


@router.get("/summary", response_model=SignalSummary)
async def get_signal_summary(
    db: Session = Depends(get_db)
):
    """
    Get summary statistics of active signals.
    """
    now = utc_now()

    # Active signals (not acknowledged, not expired)
    active_query = db.query(EarlySignal).filter(
        EarlySignal.acknowledged == False,
        (EarlySignal.expires_at == None) | (EarlySignal.expires_at > now)
    )

    total_active = active_query.count()

    # By type
    by_type = {}
    type_counts = active_query.with_entities(
        EarlySignal.signal_type,
        func.count(EarlySignal.id)
    ).group_by(EarlySignal.signal_type).all()
    for signal_type, count in type_counts:
        by_type[signal_type] = count

    # By severity
    by_severity = {}
    severity_counts = active_query.with_entities(
        EarlySignal.severity,
        func.count(EarlySignal.id)
    ).group_by(EarlySignal.severity).all()
    for severity, count in severity_counts:
        by_severity[severity] = count

    # Repos with signals
    repos_with_signals = active_query.with_entities(
        EarlySignal.repo_id
    ).distinct().count()

    return SignalSummary(
        total_active=total_active,
        by_type=by_type,
        by_severity=by_severity,
        repos_with_signals=repos_with_signals,
    )


@router.post("/{signal_id}/acknowledge")
async def acknowledge_signal(
    signal_id: int,
    db: Session = Depends(get_db)
):
    """
    Acknowledge an early signal (mark as seen).
    """
    signal = db.query(EarlySignal).filter(EarlySignal.id == signal_id).first()
    if not signal:
        raise HTTPException(status_code=404, detail="Signal not found")

    signal.acknowledged = True
    signal.acknowledged_at = utc_now()
    db.commit()

    return {"status": "ok", "message": "Signal acknowledged"}


@router.post("/acknowledge-all")
async def acknowledge_all_signals(
    signal_type: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """
    Acknowledge all active signals.
    Optionally filter by signal type.
    """
    query = db.query(EarlySignal).filter(EarlySignal.acknowledged == False)

    if signal_type:
        query = query.filter(EarlySignal.signal_type == signal_type)

    now = utc_now()
    count = query.update({
        EarlySignal.acknowledged: True,
        EarlySignal.acknowledged_at: now,
    })
    db.commit()

    return {"status": "ok", "message": f"{count} signals acknowledged"}


@router.post("/detect", response_model=DetectionResultResponse)
async def trigger_detection(
    db: Session = Depends(get_db)
):
    """
    Manually trigger anomaly detection for all repos.
    """
    result = run_detection(db)

    return DetectionResultResponse(
        repos_scanned=result["repos_scanned"],
        signals_detected=result["signals_detected"],
        by_type=result["by_type"],
    )


@router.delete("/{signal_id}")
async def delete_signal(
    signal_id: int,
    db: Session = Depends(get_db)
):
    """
    Delete an early signal.
    """
    signal = db.query(EarlySignal).filter(EarlySignal.id == signal_id).first()
    if not signal:
        raise HTTPException(status_code=404, detail="Signal not found")

    db.delete(signal)
    db.commit()

    return {"status": "ok", "message": "Signal deleted"}
