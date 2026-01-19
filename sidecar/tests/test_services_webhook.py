"""
Tests for services/webhook.py - Webhook notification service.
"""

import pytest
import json
from datetime import datetime
from unittest.mock import MagicMock, patch, AsyncMock

from services.webhook import (
    WebhookService,
    _safe_json_loads,
    get_webhook_service,
    trigger_signal_webhooks,
    trigger_digest_webhooks,
)
from db.models import WebhookType, WebhookTrigger


class TestSafeJsonLoads:
    """Tests for _safe_json_loads function."""

    def test_valid_json(self):
        """Test parsing valid JSON."""
        result = _safe_json_loads('["a", "b", "c"]')
        assert result == ["a", "b", "c"]

    def test_empty_string(self):
        """Test empty string returns default."""
        result = _safe_json_loads("")
        assert result == []

    def test_none_value(self):
        """Test None returns default."""
        result = _safe_json_loads(None)
        assert result == []

    def test_invalid_json(self):
        """Test invalid JSON returns default."""
        result = _safe_json_loads("not valid json")
        assert result == []

    def test_custom_default(self):
        """Test custom default value."""
        result = _safe_json_loads(None, default={"key": "value"})
        assert result == {"key": "value"}


class TestWebhookServicePayloads:
    """Tests for WebhookService payload building methods."""

    def test_build_slack_payload(self):
        """Test building Slack payload."""
        payload = WebhookService._build_slack_payload(
            title="Test Title",
            text="Test text",
            color="#ff0000",
            fields=[{"title": "Field", "value": "Value", "short": True}]
        )

        assert "attachments" in payload
        attachment = payload["attachments"][0]
        assert attachment["title"] == "Test Title"
        assert attachment["text"] == "Test text"
        assert attachment["color"] == "#ff0000"
        assert "fields" in attachment

    def test_build_slack_payload_no_fields(self):
        """Test building Slack payload without fields."""
        payload = WebhookService._build_slack_payload(
            title="Title",
            text="Text"
        )
        assert "fields" not in payload["attachments"][0]

    def test_build_discord_payload(self):
        """Test building Discord payload."""
        payload = WebhookService._build_discord_payload(
            title="Test Title",
            description="Test description",
            color=0xff0000,
            fields=[{"title": "Field", "value": "Value", "short": True}]
        )

        assert "embeds" in payload
        embed = payload["embeds"][0]
        assert embed["title"] == "Test Title"
        assert embed["description"] == "Test description"
        assert embed["color"] == 0xff0000
        assert "fields" in embed

    def test_build_discord_payload_no_fields(self):
        """Test building Discord payload without fields."""
        payload = WebhookService._build_discord_payload(
            title="Title",
            description="Description"
        )
        assert "fields" not in payload["embeds"][0]

    def test_build_generic_payload(self):
        """Test building generic payload."""
        payload = WebhookService._build_generic_payload(
            event_type="test_event",
            data={"key": "value"}
        )

        assert payload["event"] == "test_event"
        assert payload["source"] == "starscope"
        assert payload["data"] == {"key": "value"}
        assert "timestamp" in payload

    def test_severity_to_color(self):
        """Test severity color conversion."""
        assert WebhookService._severity_to_color("high") == ("#dc2626", 0xdc2626)
        assert WebhookService._severity_to_color("medium") == ("#ca8a04", 0xca8a04)
        assert WebhookService._severity_to_color("low") == ("#6b7280", 0x6b7280)
        assert WebhookService._severity_to_color("unknown") == ("#2563eb", 0x2563eb)


class TestWebhookServiceDigestText:
    """Tests for _build_digest_text method."""

    def test_build_digest_text_no_signals(self):
        """Test digest text with no signals."""
        repos = [MagicMock()]
        signals = []

        text = WebhookService._build_digest_text(repos, signals)

        assert "*1 repos tracked*" in text
        assert "No new signals detected" in text

    def test_build_digest_text_with_signals(self):
        """Test digest text with signals."""
        repos = [MagicMock(), MagicMock()]
        signals = [
            MagicMock(signal_type="rising_star"),
            MagicMock(signal_type="rising_star"),
            MagicMock(signal_type="sudden_spike"),
        ]

        text = WebhookService._build_digest_text(repos, signals)

        assert "*2 repos tracked*" in text
        assert "*3 new signals detected*" in text
        assert "Rising Star: 2" in text
        assert "Sudden Spike: 1" in text


class TestWebhookServiceSending:
    """Tests for WebhookService sending methods."""

    @pytest.mark.asyncio
    async def test_send_signal_notification_slack(self, test_db, mock_webhook, mock_early_signal):
        """Test sending signal notification to Slack."""
        repo, signal = mock_early_signal
        mock_webhook.webhook_type = WebhookType.SLACK

        service = WebhookService()

        with patch.object(service.client, 'post', new_callable=AsyncMock) as mock_post:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_post.return_value = mock_response

            result = await service.send_signal_notification(mock_webhook, signal, test_db)

            assert result is True
            mock_post.assert_called_once()

        await service.close()

    @pytest.mark.asyncio
    async def test_send_signal_notification_discord(self, test_db, mock_webhook, mock_early_signal):
        """Test sending signal notification to Discord."""
        repo, signal = mock_early_signal
        mock_webhook.webhook_type = WebhookType.DISCORD

        service = WebhookService()

        with patch.object(service.client, 'post', new_callable=AsyncMock) as mock_post:
            mock_response = MagicMock()
            mock_response.status_code = 204  # Discord returns 204 on success
            mock_post.return_value = mock_response

            result = await service.send_signal_notification(mock_webhook, signal, test_db)

            assert result is True

        await service.close()

    @pytest.mark.asyncio
    async def test_send_signal_notification_failure(self, test_db, mock_webhook, mock_early_signal):
        """Test handling webhook failure."""
        repo, signal = mock_early_signal

        service = WebhookService()

        with patch.object(service.client, 'post', new_callable=AsyncMock) as mock_post:
            mock_response = MagicMock()
            mock_response.status_code = 500
            mock_response.text = "Internal Server Error"
            mock_post.return_value = mock_response

            result = await service.send_signal_notification(mock_webhook, signal, test_db)

            assert result is False

        await service.close()

    @pytest.mark.asyncio
    async def test_send_webhook_timeout(self, test_db, mock_webhook, mock_early_signal):
        """Test handling webhook timeout."""
        import httpx
        repo, signal = mock_early_signal

        service = WebhookService()

        with patch.object(service.client, 'post', new_callable=AsyncMock) as mock_post:
            mock_post.side_effect = httpx.TimeoutException("Connection timed out")

            result = await service.send_signal_notification(mock_webhook, signal, test_db)

            assert result is False

        await service.close()

    @pytest.mark.asyncio
    async def test_send_digest(self, test_db, mock_webhook, mock_multiple_repos):
        """Test sending digest notification."""
        service = WebhookService()

        with patch.object(service.client, 'post', new_callable=AsyncMock) as mock_post:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_post.return_value = mock_response

            result = await service.send_digest(
                mock_webhook,
                WebhookTrigger.DAILY_DIGEST,
                mock_multiple_repos,
                [],
                test_db
            )

            assert result is True

        await service.close()

    @pytest.mark.asyncio
    async def test_test_webhook(self, test_db, mock_webhook):
        """Test sending test webhook."""
        service = WebhookService()

        with patch.object(service.client, 'post', new_callable=AsyncMock) as mock_post:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_post.return_value = mock_response

            result = await service.test_webhook(mock_webhook, test_db)

            assert result is True

        await service.close()


class TestGetWebhookService:
    """Tests for get_webhook_service function."""

    def test_returns_singleton(self):
        """Test that service is a singleton."""
        # Reset singleton
        import services.webhook as webhook_module
        webhook_module._webhook_service = None

        service1 = get_webhook_service()
        service2 = get_webhook_service()

        assert service1 is service2


class TestTriggerSignalWebhooks:
    """Tests for trigger_signal_webhooks function."""

    @pytest.mark.asyncio
    async def test_triggers_matching_webhooks(self, test_db, mock_webhook, mock_early_signal):
        """Test that matching webhooks are triggered."""
        repo, signal = mock_early_signal
        mock_webhook.triggers = json.dumps([WebhookTrigger.SIGNAL_DETECTED])
        mock_webhook.enabled = True
        test_db.commit()

        with patch('services.webhook.get_webhook_service') as mock_get_service:
            mock_service = MagicMock()
            mock_service.send_signal_notification = AsyncMock(return_value=True)
            mock_get_service.return_value = mock_service

            await trigger_signal_webhooks(signal, test_db)

            mock_service.send_signal_notification.assert_called()

    @pytest.mark.asyncio
    async def test_skips_disabled_webhooks(self, test_db, mock_webhook, mock_early_signal):
        """Test that disabled webhooks are skipped."""
        repo, signal = mock_early_signal
        mock_webhook.enabled = False
        test_db.commit()

        with patch('services.webhook.get_webhook_service') as mock_get_service:
            mock_service = MagicMock()
            mock_service.send_signal_notification = AsyncMock(return_value=True)
            mock_get_service.return_value = mock_service

            await trigger_signal_webhooks(signal, test_db)

            mock_service.send_signal_notification.assert_not_called()

    @pytest.mark.asyncio
    async def test_respects_severity_filter(self, test_db, mock_webhook, mock_early_signal):
        """Test that severity filter is respected."""
        repo, signal = mock_early_signal
        signal.severity = "low"
        mock_webhook.triggers = json.dumps([WebhookTrigger.SIGNAL_DETECTED])
        mock_webhook.enabled = True
        mock_webhook.min_severity = "high"  # Should filter out low severity
        test_db.commit()

        with patch('services.webhook.get_webhook_service') as mock_get_service:
            mock_service = MagicMock()
            mock_service.send_signal_notification = AsyncMock(return_value=True)
            mock_get_service.return_value = mock_service

            await trigger_signal_webhooks(signal, test_db)

            mock_service.send_signal_notification.assert_not_called()


class TestTriggerDigestWebhooks:
    """Tests for trigger_digest_webhooks function."""

    @pytest.mark.asyncio
    async def test_triggers_matching_digest_webhooks(self, test_db, mock_webhook, mock_multiple_repos):
        """Test that matching digest webhooks are triggered."""
        mock_webhook.triggers = json.dumps([WebhookTrigger.DAILY_DIGEST])
        mock_webhook.enabled = True
        test_db.commit()

        with patch('services.webhook.get_webhook_service') as mock_get_service:
            mock_service = MagicMock()
            mock_service.send_digest = AsyncMock(return_value=True)
            mock_get_service.return_value = mock_service

            await trigger_digest_webhooks(WebhookTrigger.DAILY_DIGEST, mock_multiple_repos, [], test_db)

            mock_service.send_digest.assert_called()
