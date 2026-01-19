"""
Webhook service for sending notifications.
Supports Slack, Discord, and generic HTTP POST webhooks.
"""

import json
import logging
from datetime import datetime
from typing import List, Optional, Dict, Any

import httpx
from sqlalchemy import update
from sqlalchemy.orm import Session

from db.models import (
    Webhook, WebhookLog, WebhookType, WebhookTrigger,
    EarlySignal, Repo,
)
from utils.time import utc_now

logger = logging.getLogger(__name__)

# Timeout for webhook requests
WEBHOOK_TIMEOUT = 10.0


def _safe_json_loads(json_str: Optional[str], default: Any = None) -> Any:
    """Safely parse JSON string, returning default value on error."""
    if not json_str:
        return default if default is not None else []
    try:
        return json.loads(json_str)
    except (json.JSONDecodeError, TypeError) as e:
        logger.warning(f"Failed to parse JSON: {e}, value: {json_str[:100] if json_str else 'None'}")
        return default if default is not None else []


class WebhookService:
    """Service for managing and sending webhooks."""

    def __init__(self):
        self.client = httpx.AsyncClient(timeout=WEBHOOK_TIMEOUT)

    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()

    @staticmethod
    def _build_slack_payload(
        title: str,
        text: str,
        color: str = "#2563eb",
        fields: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """Build a Slack-compatible message payload."""
        attachment = {
            "color": color,
            "title": title,
            "text": text,
            "ts": int(datetime.now().timestamp()),
        }
        if fields:
            attachment["fields"] = fields

        return {
            "attachments": [attachment]
        }

    @staticmethod
    def _build_discord_payload(
        title: str,
        description: str,
        color: int = 0x2563eb,
        fields: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """Build a Discord-compatible message payload."""
        embed = {
            "title": title,
            "description": description,
            "color": color,
            "timestamp": datetime.now().isoformat(),
            "footer": {
                "text": "StarScope"
            }
        }
        if fields:
            embed["fields"] = [
                {"name": f["title"], "value": str(f["value"]), "inline": f.get("short", True)}
                for f in fields
            ]

        return {
            "embeds": [embed]
        }

    @staticmethod
    def _build_generic_payload(
        event_type: str,
        data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Build a generic webhook payload."""
        return {
            "event": event_type,
            "timestamp": utc_now().isoformat(),
            "source": "starscope",
            "data": data,
        }

    @staticmethod
    def _build_digest_text(repos: List[Repo], signals: List[EarlySignal]) -> str:
        """Build the summary text for a digest notification."""
        text_parts = [f"*{len(repos)} repos tracked*"]
        if signals:
            text_parts.append(f"*{len(signals)} new signals detected*")

            # Group by type
            by_type: Dict[str, int] = {}
            for s in signals:
                by_type[s.signal_type] = by_type.get(s.signal_type, 0) + 1

            for stype, count in sorted(by_type.items(), key=lambda x: -x[1]):
                text_parts.append(f"  - {stype.replace('_', ' ').title()}: {count}")
        else:
            text_parts.append("No new signals detected")

        return "\n".join(text_parts)

    @staticmethod
    def _severity_to_color(severity: str) -> tuple:
        """Convert severity to Slack color and Discord color int."""
        colors = {
            "high": ("#dc2626", 0xdc2626),
            "medium": ("#ca8a04", 0xca8a04),
            "low": ("#6b7280", 0x6b7280),
        }
        return colors.get(severity, ("#2563eb", 0x2563eb))

    async def send_signal_notification(
        self,
        webhook: Webhook,
        signal: EarlySignal,
        db: Session
    ) -> bool:
        """Send a notification about a detected signal."""
        severity = str(signal.severity) if signal.severity else "low"
        signal_type = str(signal.signal_type) if signal.signal_type else ""
        repo_full_name = str(signal.repo.full_name) if signal.repo else ""

        slack_color, discord_color = self._severity_to_color(severity)

        title = f"New {signal_type.replace('_', ' ').title()} Detected"
        text = f"*{repo_full_name}*\n{signal.description}"

        fields: List[Dict[str, Any]] = [
            {"title": "Severity", "value": severity.upper(), "short": True},
            {"title": "Stars", "value": f"{signal.star_count:,}" if signal.star_count else "N/A", "short": True},
        ]
        if signal.velocity_value:
            fields.append({"title": "Velocity", "value": f"{signal.velocity_value:.1f}/day", "short": True})

        if webhook.webhook_type == WebhookType.SLACK:
            payload = self._build_slack_payload(title, text, slack_color, fields)
        elif webhook.webhook_type == WebhookType.DISCORD:
            payload = self._build_discord_payload(title, text, discord_color, fields)
        else:
            payload = self._build_generic_payload(WebhookTrigger.SIGNAL_DETECTED, {
                "signal_id": signal.id,
                "repo_name": repo_full_name,
                "signal_type": signal_type,
                "severity": severity,
                "description": signal.description,
                "velocity": signal.velocity_value,
                "stars": signal.star_count,
            })

        return await self._send_webhook(webhook, WebhookTrigger.SIGNAL_DETECTED, payload, db)

    async def send_digest(
        self,
        webhook: Webhook,
        digest_type: str,  # daily_digest or weekly_digest
        repos: List[Repo],
        signals: List[EarlySignal],
        db: Session
    ) -> bool:
        """Send a digest summary."""
        period = "Daily" if digest_type == WebhookTrigger.DAILY_DIGEST else "Weekly"
        title = f"StarScope {period} Digest"

        # Build summary text using helper
        text = self._build_digest_text(repos, signals)

        fields: List[Dict[str, Any]] = [
            {"title": "Repos Tracked", "value": str(len(repos)), "short": True},
            {"title": "New Signals", "value": str(len(signals)), "short": True},
        ]

        if webhook.webhook_type == WebhookType.SLACK:
            payload = self._build_slack_payload(title, text, "#2563eb", fields)
        elif webhook.webhook_type == WebhookType.DISCORD:
            payload = self._build_discord_payload(title, text, 0x2563eb, fields)
        else:
            signal_list: List[Dict[str, Any]] = [
                {
                    "repo": str(s.repo.full_name) if s.repo else "",
                    "type": str(s.signal_type) if s.signal_type else "",
                    "severity": str(s.severity) if s.severity else "",
                }
                for s in signals[:10]  # Limit to 10 in generic payload
            ]
            payload = self._build_generic_payload(digest_type, {
                "repos_count": len(repos),
                "signals_count": len(signals),
                "signals": signal_list,
            })

        return await self._send_webhook(webhook, digest_type, payload, db)

    async def _send_webhook(
        self,
        webhook: Webhook,
        trigger_type: str,
        payload: dict,
        db: Session
    ) -> bool:
        """Send the actual HTTP request to the webhook URL."""
        webhook_id = int(webhook.id)
        webhook_url = str(webhook.url) if webhook.url else ""
        webhook_name = str(webhook.name) if webhook.name else ""

        log = WebhookLog(
            webhook_id=webhook_id,
            trigger_type=trigger_type,
            payload_summary=json.dumps(payload)[:500],
        )

        success = False
        error_message: Optional[str] = None

        try:
            response = await self.client.post(
                webhook_url,
                json=payload,
                headers={"Content-Type": "application/json"}
            )

            log.status_code = response.status_code
            success = 200 <= response.status_code < 300
            log.success = success

            if not success:
                error_message = f"HTTP {response.status_code}: {response.text[:200]}"
                log.error_message = error_message

        except httpx.TimeoutException:
            log.success = False
            error_message = "Request timed out"
            log.error_message = error_message
            logger.error(f"Webhook timeout: {webhook_name}")

        except Exception as e:
            log.success = False
            error_message = str(e)[:500]
            log.error_message = error_message
            logger.error(f"Webhook error for {webhook_name}: {e}")

        # Use a single timestamp for consistency
        now = utc_now()
        log.sent_at = now

        # Use atomic update to prevent race conditions when multiple
        # webhook notifications are sent concurrently
        try:
            stmt = update(Webhook).where(Webhook.id == webhook_id).values(
                last_triggered=now,
                last_error=error_message
            )
            db.execute(stmt)
            db.add(log)
            db.commit()
        except Exception as commit_error:
            logger.error(f"Failed to commit webhook log: {commit_error}")
            db.rollback()

        return success

    async def test_webhook(self, webhook: Webhook, db: Session) -> bool:
        """Send a test message to verify webhook configuration."""
        title = "StarScope Test Message"
        text = "This is a test message from StarScope. Your webhook is configured correctly!"

        if webhook.webhook_type == WebhookType.SLACK:
            payload = self._build_slack_payload(title, text, "#16a34a")
        elif webhook.webhook_type == WebhookType.DISCORD:
            payload = self._build_discord_payload(title, text, 0x16a34a)
        else:
            payload = self._build_generic_payload("test", {"message": text})

        return await self._send_webhook(webhook, "test", payload, db)


# Module-level singleton
_webhook_service: Optional[WebhookService] = None


def get_webhook_service() -> WebhookService:
    """Get the webhook service singleton."""
    global _webhook_service
    if _webhook_service is None:
        _webhook_service = WebhookService()
        logger.info("Webhook service initialized")
    return _webhook_service


async def trigger_signal_webhooks(signal: EarlySignal, db: Session):
    """Trigger all applicable webhooks for a new signal."""
    service = get_webhook_service()

    # Find webhooks that should be triggered
    webhooks = db.query(Webhook).filter(
        Webhook.enabled.is_(True),
    ).all()

    for webhook in webhooks:
        # Check if this webhook has signal_detected trigger
        triggers = _safe_json_loads(webhook.triggers, [])
        if WebhookTrigger.SIGNAL_DETECTED not in triggers:
            continue

        # Check severity filter
        if webhook.min_severity:
            severity_order = {"low": 0, "medium": 1, "high": 2}
            signal_sev = str(signal.severity) if signal.severity else "low"
            min_sev = str(webhook.min_severity)
            if severity_order.get(signal_sev, 0) < severity_order.get(min_sev, 0):
                continue

        # Send the notification
        await service.send_signal_notification(webhook, signal, db)


async def trigger_digest_webhooks(
    digest_type: str,
    repos: List[Repo],
    signals: List[EarlySignal],
    db: Session
):
    """Trigger all applicable webhooks for a digest."""
    service = get_webhook_service()

    webhooks = db.query(Webhook).filter(
        Webhook.enabled.is_(True),
    ).all()

    for webhook in webhooks:
        triggers = _safe_json_loads(webhook.triggers, [])
        if digest_type not in triggers:
            continue

        await service.send_digest(webhook, digest_type, repos, signals, db)
