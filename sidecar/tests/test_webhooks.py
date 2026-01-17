"""
Tests for webhook endpoints.
"""


class TestWebhookEndpoints:
    """Test cases for /api/webhooks endpoints."""

    def test_list_webhooks_empty(self, client):
        """Test listing webhooks when none exist."""
        response = client.get("/api/webhooks")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0
        assert data["webhooks"] == []

    def test_create_webhook_invalid_url(self, client):
        """Test creating webhook with invalid URL."""
        response = client.post("/api/webhooks", json={
            "name": "Test Webhook",
            "webhook_type": "generic",
            "url": "not-a-valid-url",
            "triggers": ["signal_detected"]
        })
        assert response.status_code == 400
        assert "Invalid webhook URL" in response.json()["detail"]

    def test_create_webhook_missing_fields(self, client):
        """Test creating webhook with missing required fields."""
        response = client.post("/api/webhooks", json={
            "name": "Test"
        })
        assert response.status_code == 422  # Validation error

    def test_delete_nonexistent_webhook(self, client):
        """Test deleting a webhook that doesn't exist."""
        response = client.delete("/api/webhooks/99999")
        assert response.status_code == 404

    def test_update_nonexistent_webhook(self, client):
        """Test updating a webhook that doesn't exist."""
        response = client.put("/api/webhooks/99999", json={
            "name": "Updated Name"
        })
        assert response.status_code == 404

    def test_test_nonexistent_webhook(self, client):
        """Test testing a webhook that doesn't exist."""
        response = client.post("/api/webhooks/99999/test")
        assert response.status_code == 404
