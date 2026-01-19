"""
Alerts API endpoints for managing alert rules and viewing triggered alerts.
"""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import AlertRule, TriggeredAlert, Repo, SignalType, AlertOperator
from services.alerts import (
    acknowledge_alert,
    acknowledge_all_alerts,
    check_all_alerts,
)

# Error message constants
ERROR_RULE_NOT_FOUND = "Rule not found"
ERROR_ALERT_NOT_FOUND = "Alert not found"

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


# --- Schemas ---

class AlertRuleCreate(BaseModel):
    """Schema for creating an alert rule."""
    name: str
    description: Optional[str] = None
    repo_id: Optional[int] = None  # None = applies to all repos
    signal_type: str  # e.g., "stars_delta_7d", "velocity"
    operator: str  # ">", "<", ">=", "<=", "=="
    threshold: float
    enabled: bool = True


class AlertRuleUpdate(BaseModel):
    """Schema for updating an alert rule."""
    name: Optional[str] = None
    description: Optional[str] = None
    repo_id: Optional[int] = None
    signal_type: Optional[str] = None
    operator: Optional[str] = None
    threshold: Optional[float] = None
    enabled: Optional[bool] = None


class AlertRuleResponse(BaseModel):
    """Response schema for an alert rule."""
    id: int
    name: str
    description: Optional[str]
    repo_id: Optional[int]
    repo_name: Optional[str]
    signal_type: str
    operator: str
    threshold: float
    enabled: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class TriggeredAlertResponse(BaseModel):
    """Response schema for a triggered alert."""
    id: int
    rule_id: int
    rule_name: str
    repo_id: int
    repo_name: str
    signal_type: str
    signal_value: float
    threshold: float
    operator: str
    triggered_at: datetime
    acknowledged: bool
    acknowledged_at: Optional[datetime]

    class Config:
        from_attributes = True


class SignalTypeInfo(BaseModel):
    """Information about a signal type."""
    type: str
    name: str
    description: str


# --- Helper functions ---

def _to_alert_rule_response(rule: "AlertRule") -> AlertRuleResponse:
    """Convert an AlertRule model to AlertRuleResponse."""
    return AlertRuleResponse(
        id=rule.id,
        name=rule.name,
        description=rule.description,
        repo_id=rule.repo_id,
        repo_name=rule.repo.full_name if rule.repo else None,
        signal_type=rule.signal_type,
        operator=rule.operator,
        threshold=rule.threshold,
        enabled=bool(rule.enabled),
        created_at=rule.created_at,
        updated_at=rule.updated_at,
    )


def _to_triggered_alert_response(alert: "TriggeredAlert") -> TriggeredAlertResponse:
    """Convert a TriggeredAlert model to TriggeredAlertResponse."""
    return TriggeredAlertResponse(
        id=alert.id,
        rule_id=alert.rule_id,
        rule_name=alert.rule.name,
        repo_id=alert.repo_id,
        repo_name=alert.repo.full_name,
        signal_type=alert.rule.signal_type,
        signal_value=alert.signal_value,
        threshold=alert.rule.threshold,
        operator=alert.rule.operator,
        triggered_at=alert.triggered_at,
        acknowledged=bool(alert.acknowledged),
        acknowledged_at=alert.acknowledged_at,
    )


def validate_signal_type(signal_type: str) -> bool:
    """Check if a signal type is valid."""
    valid_types = [
        SignalType.STARS_DELTA_7D,
        SignalType.STARS_DELTA_30D,
        SignalType.VELOCITY,
        SignalType.ACCELERATION,
        SignalType.TREND,
    ]
    return signal_type in valid_types


def validate_operator(operator: str) -> bool:
    """Check if an operator is valid."""
    valid_operators = [
        AlertOperator.GT,
        AlertOperator.LT,
        AlertOperator.GTE,
        AlertOperator.LTE,
        AlertOperator.EQ,
    ]
    return operator in valid_operators


# --- Endpoints ---

@router.get("/signal-types", response_model=List[SignalTypeInfo])
async def list_signal_types():
    """List available signal types for alert rules."""
    return [
        SignalTypeInfo(
            type=SignalType.STARS_DELTA_7D,
            name="7-Day Star Delta",
            description="Number of stars gained in the last 7 days"
        ),
        SignalTypeInfo(
            type=SignalType.STARS_DELTA_30D,
            name="30-Day Star Delta",
            description="Number of stars gained in the last 30 days"
        ),
        SignalTypeInfo(
            type=SignalType.VELOCITY,
            name="Star Velocity",
            description="Average stars per day (7-day average)"
        ),
        SignalTypeInfo(
            type=SignalType.ACCELERATION,
            name="Acceleration",
            description="Rate of change in velocity"
        ),
        SignalTypeInfo(
            type=SignalType.TREND,
            name="Trend",
            description="Overall trend direction (-1=down, 0=stable, 1=up)"
        ),
    ]


@router.get("/rules", response_model=List[AlertRuleResponse])
async def list_rules(db: Session = Depends(get_db)):
    """List all alert rules."""
    rules = db.query(AlertRule).all()

    return [_to_alert_rule_response(rule) for rule in rules]


@router.post("/rules", response_model=AlertRuleResponse)
async def create_rule(rule: AlertRuleCreate, db: Session = Depends(get_db)):
    """Create a new alert rule."""
    # Validate signal type
    if not validate_signal_type(rule.signal_type):
        raise HTTPException(status_code=400, detail=f"Invalid signal type: {rule.signal_type}")

    # Validate operator
    if not validate_operator(rule.operator):
        raise HTTPException(status_code=400, detail=f"Invalid operator: {rule.operator}")

    # Validate repo if specified
    if rule.repo_id:
        repo = db.query(Repo).filter(Repo.id == rule.repo_id).first()
        if not repo:
            raise HTTPException(status_code=404, detail=f"Repo not found: {rule.repo_id}")

    # Create the rule
    db_rule = AlertRule(
        name=rule.name,
        description=rule.description,
        repo_id=rule.repo_id,
        signal_type=rule.signal_type,
        operator=rule.operator,
        threshold=rule.threshold,
        enabled=rule.enabled,
    )
    db.add(db_rule)
    db.commit()
    db.refresh(db_rule)

    return _to_alert_rule_response(db_rule)


@router.get("/rules/{rule_id}", response_model=AlertRuleResponse)
async def get_rule(rule_id: int, db: Session = Depends(get_db)):
    """Get a specific alert rule."""
    rule = db.query(AlertRule).filter(AlertRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail=ERROR_RULE_NOT_FOUND)

    return _to_alert_rule_response(rule)


@router.patch("/rules/{rule_id}", response_model=AlertRuleResponse)
async def update_rule(rule_id: int, update: AlertRuleUpdate, db: Session = Depends(get_db)):
    """Update an alert rule."""
    rule = db.query(AlertRule).filter(AlertRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail=ERROR_RULE_NOT_FOUND)

    # Validate and update fields
    if update.signal_type is not None:
        if not validate_signal_type(update.signal_type):
            raise HTTPException(status_code=400, detail=f"Invalid signal type: {update.signal_type}")
        rule.signal_type = update.signal_type

    if update.operator is not None:
        if not validate_operator(update.operator):
            raise HTTPException(status_code=400, detail=f"Invalid operator: {update.operator}")
        rule.operator = update.operator

    if update.name is not None:
        rule.name = update.name
    if update.description is not None:
        rule.description = update.description
    if update.repo_id is not None:
        rule.repo_id = update.repo_id
    if update.threshold is not None:
        rule.threshold = update.threshold
    if update.enabled is not None:
        rule.enabled = update.enabled

    db.commit()
    db.refresh(rule)

    return _to_alert_rule_response(rule)


@router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: int, db: Session = Depends(get_db)):
    """Delete an alert rule."""
    rule = db.query(AlertRule).filter(AlertRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail=ERROR_RULE_NOT_FOUND)

    db.delete(rule)
    db.commit()

    return {"status": "deleted", "id": rule_id}


@router.get("/triggered", response_model=List[TriggeredAlertResponse])
async def list_triggered_alerts(
    unacknowledged_only: bool = False,
    limit: int = 50,
    db: Session = Depends(get_db)
):
    """List triggered alerts."""
    query = db.query(TriggeredAlert).order_by(TriggeredAlert.triggered_at.desc())

    if unacknowledged_only:
        query = query.filter(TriggeredAlert.acknowledged == False)

    alerts = query.limit(limit).all()

    return [_to_triggered_alert_response(alert) for alert in alerts]


@router.post("/triggered/{alert_id}/acknowledge")
async def acknowledge_single_alert(alert_id: int, db: Session = Depends(get_db)):
    """Acknowledge a triggered alert."""
    if acknowledge_alert(db, alert_id):
        return {"status": "acknowledged", "id": alert_id}
    raise HTTPException(status_code=404, detail=ERROR_ALERT_NOT_FOUND)


@router.post("/triggered/acknowledge-all")
async def acknowledge_all(db: Session = Depends(get_db)):
    """Acknowledge all unacknowledged alerts."""
    count = acknowledge_all_alerts(db)
    return {"status": "acknowledged", "count": count}


@router.post("/check")
async def check_alerts_now(db: Session = Depends(get_db)):
    """Manually trigger an alert check."""
    triggered = await check_all_alerts(db)
    return {
        "status": "checked",
        "triggered_count": len(triggered),
        "triggered": [
            {
                "id": alert.id,
                "rule_id": alert.rule_id,
                "repo_id": alert.repo_id,
                "signal_value": alert.signal_value,
            }
            for alert in triggered
        ]
    }
