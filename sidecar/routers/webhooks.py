"""
Webhook API endpoints.
Provides CRUD operations for webhook configuration.
"""

import json
import logging
from typing import List, Optional, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, HttpUrl
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Webhook, WebhookLog, WebhookType, WebhookTrigger
from services.webhook import get_webhook_service
from utils.time import utc_now

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
logger = logging.getLogger(__name__)

# Error message constants
ERROR_WEBHOOK_NOT_FOUND = "Webhook not found"


def _safe_json_loads(json_str: Optional[str], default: Any = None) -> Any:
    """Safely parse JSON string, returning default value on error."""
    if not json_str:
        return default if default is not None else []
    try:
        return json.loads(json_str)
    except (json.JSONDecodeError, TypeError) as e:
        logger.warning(f"Failed to parse webhook triggers JSON: {e}")
        return default if default is not None else []


# Request/Response schemas
class WebhookCreate(BaseModel):
    """Schema for creating a webhook."""
    name: str
    webhook_type: str  # slack, discord, generic
    url: str
    triggers: List[str]  # signal_detected, daily_digest, weekly_digest
    min_severity: Optional[str] = None  # low, medium, high


class WebhookUpdate(BaseModel):
    """Schema for updating a webhook."""
    name: Optional[str] = None
    url: Optional[str] = None
    triggers: Optional[List[str]] = None
    min_severity: Optional[str] = None
    enabled: Optional[bool] = None


class WebhookResponse(BaseModel):
    """Response schema for a webhook."""
    id: int
    name: str
    webhook_type: str
    url: str
    triggers: List[str]
    min_severity: Optional[str]
    enabled: bool
    last_triggered: Optional[str]
    last_error: Optional[str]
    created_at: str

    class Config:
        from_attributes = True


class WebhookListResponse(BaseModel):
    """Response for webhook list."""
    webhooks: List[WebhookResponse]
    total: int


class WebhookLogResponse(BaseModel):
    """Response for a webhook log entry."""
    id: int
    trigger_type: str
    success: bool
    status_code: Optional[int]
    error_message: Optional[str]
    sent_at: str

    class Config:
        from_attributes = True


class WebhookLogsResponse(BaseModel):
    """Response for webhook logs."""
    webhook_id: int
    logs: List[WebhookLogResponse]
    total: int


def _get_webhook_or_404(webhook_id: int, db: Session) -> "Webhook":
    """Get webhook by ID or raise 404."""
    webhook = db.query(Webhook).filter(Webhook.id == webhook_id).first()
    if not webhook:
        raise HTTPException(status_code=404, detail=ERROR_WEBHOOK_NOT_FOUND)
    return webhook


def _webhook_to_response(webhook: "Webhook") -> WebhookResponse:
    """Convert Webhook model to response."""
    triggers = _safe_json_loads(webhook.triggers, [])
    return WebhookResponse(
        id=int(webhook.id),
        name=str(webhook.name),
        webhook_type=str(webhook.webhook_type),
        url=str(webhook.url),
        triggers=triggers,
        min_severity=str(webhook.min_severity) if webhook.min_severity else None,
        enabled=bool(webhook.enabled),
        last_triggered=webhook.last_triggered.isoformat() if webhook.last_triggered else None,
        last_error=str(webhook.last_error) if webhook.last_error else None,
        created_at=webhook.created_at.isoformat() if webhook.created_at else None,
    )


# Endpoints
@router.get("/", response_model=WebhookListResponse)
async def list_webhooks(
    db: Session = Depends(get_db)
):
    """List all configured webhooks."""
    webhooks = db.query(Webhook).order_by(Webhook.created_at.desc()).all()
    return WebhookListResponse(
        webhooks=[_webhook_to_response(w) for w in webhooks],
        total=len(webhooks),
    )


@router.get("/{webhook_id}", response_model=WebhookResponse)
async def get_webhook(
    webhook_id: int,
    db: Session = Depends(get_db)
):
    """Get a specific webhook."""
    webhook = _get_webhook_or_404(webhook_id, db)
    return _webhook_to_response(webhook)


@router.post("/", response_model=WebhookResponse)
async def create_webhook(
    data: WebhookCreate,
    db: Session = Depends(get_db)
):
    """Create a new webhook."""
    # Validate webhook type
    valid_types = [WebhookType.SLACK, WebhookType.DISCORD, WebhookType.GENERIC]
    if data.webhook_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid webhook type. Must be one of: {valid_types}"
        )

    # Validate triggers
    valid_triggers = [
        WebhookTrigger.SIGNAL_DETECTED,
        WebhookTrigger.DAILY_DIGEST,
        WebhookTrigger.WEEKLY_DIGEST,
        WebhookTrigger.THRESHOLD_ALERT,
    ]
    for trigger in data.triggers:
        if trigger not in valid_triggers:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid trigger: {trigger}. Must be one of: {valid_triggers}"
            )

    # Validate severity
    if data.min_severity and data.min_severity not in ["low", "medium", "high"]:
        raise HTTPException(
            status_code=400,
            detail="min_severity must be one of: low, medium, high"
        )

    # Validate URL format to prevent SSRF
    try:
        HttpUrl(data.url)
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Invalid webhook URL format. Must be a valid HTTP/HTTPS URL."
        )

    webhook = Webhook(
        name=data.name,
        webhook_type=data.webhook_type,
        url=data.url,
        triggers=json.dumps(data.triggers),
        min_severity=data.min_severity,
        enabled=True,
        created_at=utc_now(),
    )
    db.add(webhook)
    db.commit()
    db.refresh(webhook)

    return _webhook_to_response(webhook)


@router.put("/{webhook_id}", response_model=WebhookResponse)
async def update_webhook(
    webhook_id: int,
    data: WebhookUpdate,
    db: Session = Depends(get_db)
):
    """Update a webhook."""
    webhook = _get_webhook_or_404(webhook_id, db)

    if data.name is not None:
        webhook.name = data.name
    if data.url is not None:
        # Validate URL format
        try:
            HttpUrl(data.url)
        except Exception:
            raise HTTPException(
                status_code=400,
                detail="Invalid webhook URL format. Must be a valid HTTP/HTTPS URL."
            )
        webhook.url = data.url
    if data.triggers is not None:
        webhook.triggers = json.dumps(data.triggers)
    if data.min_severity is not None:
        webhook.min_severity = data.min_severity
    if data.enabled is not None:
        webhook.enabled = data.enabled

    db.commit()
    db.refresh(webhook)

    return _webhook_to_response(webhook)


@router.delete("/{webhook_id}")
async def delete_webhook(
    webhook_id: int,
    db: Session = Depends(get_db)
):
    """Delete a webhook."""
    webhook = _get_webhook_or_404(webhook_id, db)
    db.delete(webhook)
    db.commit()

    return {"status": "ok", "message": "Webhook deleted"}


@router.post("/{webhook_id}/test")
async def test_webhook(
    webhook_id: int,
    db: Session = Depends(get_db)
):
    """Send a test message to verify webhook configuration."""
    webhook = _get_webhook_or_404(webhook_id, db)
    service = get_webhook_service()
    success = await service.test_webhook(webhook, db)

    return {
        "status": "ok" if success else "error",
        "message": "Test message sent successfully" if success else "Failed to send test message",
        "success": success,
    }


@router.post("/{webhook_id}/toggle")
async def toggle_webhook(
    webhook_id: int,
    db: Session = Depends(get_db)
):
    """Toggle webhook enabled/disabled state."""
    webhook = _get_webhook_or_404(webhook_id, db)
    webhook.enabled = not webhook.enabled
    db.commit()

    return {
        "status": "ok",
        "enabled": bool(webhook.enabled),
    }


@router.get("/{webhook_id}/logs", response_model=WebhookLogsResponse)
async def get_webhook_logs(
    webhook_id: int,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db)
):
    """Get recent logs for a webhook."""
    _get_webhook_or_404(webhook_id, db)
    logs = db.query(WebhookLog).filter(
        WebhookLog.webhook_id == webhook_id
    ).order_by(WebhookLog.sent_at.desc()).limit(limit).all()

    return WebhookLogsResponse(
        webhook_id=webhook_id,
        logs=[
            WebhookLogResponse(
                id=log.id,
                trigger_type=log.trigger_type,
                success=bool(log.success),
                status_code=log.status_code,
                error_message=log.error_message,
                sent_at=log.sent_at.isoformat() if log.sent_at else None,
            )
            for log in logs
        ],
        total=len(logs),
    )


@router.get("/types/list")
async def list_webhook_types():
    """List available webhook types and triggers."""
    return {
        "types": [
            {"id": WebhookType.SLACK, "name": "Slack", "description": "Slack incoming webhook"},
            {"id": WebhookType.DISCORD, "name": "Discord", "description": "Discord webhook"},
            {"id": WebhookType.GENERIC, "name": "Generic", "description": "Generic HTTP POST"},
        ],
        "triggers": [
            {"id": WebhookTrigger.SIGNAL_DETECTED, "name": "Signal Detected", "description": "When a new early signal is detected"},
            {"id": WebhookTrigger.DAILY_DIGEST, "name": "Daily Digest", "description": "Daily summary of activity"},
            {"id": WebhookTrigger.WEEKLY_DIGEST, "name": "Weekly Digest", "description": "Weekly summary of activity"},
            {"id": WebhookTrigger.THRESHOLD_ALERT, "name": "Threshold Alert", "description": "When a custom threshold is exceeded"},
        ],
        "severities": [
            {"id": "low", "name": "Low"},
            {"id": "medium", "name": "Medium"},
            {"id": "high", "name": "High"},
        ],
    }
