"""
Tests for alerts endpoints.
"""

import pytest

from constants import SignalType
from db.models import AlertRule, TriggeredAlert
from utils.time import utc_now


def _create_rule(test_db, mock_repo=None, **overrides):
    """Helper to create an AlertRule in the database."""
    defaults = {
        "name": "Test Rule",
        "description": "A test alert rule",
        "repo_id": mock_repo.id if mock_repo else None,
        "signal_type": SignalType.STARS_DELTA_7D,
        "operator": ">",
        "threshold": 100.0,
        "enabled": True,
    }
    defaults.update(overrides)
    rule = AlertRule(**defaults)
    test_db.add(rule)
    test_db.commit()
    test_db.refresh(rule)
    return rule


def _create_triggered_alert(test_db, rule, repo):
    """Helper to create a TriggeredAlert in the database."""
    alert = TriggeredAlert(
        rule_id=rule.id,
        repo_id=repo.id,
        signal_value=150.0,
        triggered_at=utc_now(),
        acknowledged=False,
    )
    test_db.add(alert)
    test_db.commit()
    test_db.refresh(alert)
    return alert


class TestSignalTypes:
    """Test cases for GET /api/alerts/signal-types."""

    def test_list_signal_types(self, client):
        """Test listing all available signal types."""
        response = client.get("/api/alerts/signal-types")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 5

        type_values = [item["type"] for item in data]
        assert "stars_delta_7d" in type_values
        assert "stars_delta_30d" in type_values
        assert "velocity" in type_values
        assert "acceleration" in type_values
        assert "trend" in type_values

        # Verify each item has required fields
        for item in data:
            assert "type" in item
            assert "name" in item
            assert "description" in item


class TestAlertRules:
    """Test cases for /api/alerts/rules endpoints."""

    def test_list_rules_empty(self, client):
        """Test listing rules when none exist."""
        response = client.get("/api/alerts/rules")
        assert response.status_code == 200
        data = response.json()
        assert data == []

    def test_create_rule(self, client, mock_repo):
        """Test creating a new alert rule."""
        payload = {
            "name": "Star Spike Alert",
            "description": "Alert when stars delta exceeds threshold",
            "repo_id": mock_repo.id,
            "signal_type": "stars_delta_7d",
            "operator": ">",
            "threshold": 50.0,
            "enabled": True,
        }
        response = client.post("/api/alerts/rules", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Star Spike Alert"
        assert data["repo_id"] == mock_repo.id
        assert data["repo_name"] == mock_repo.full_name
        assert data["signal_type"] == "stars_delta_7d"
        assert data["operator"] == ">"
        assert data["threshold"] == pytest.approx(50.0)
        assert data["enabled"] is True
        assert "id" in data
        assert "created_at" in data

    def test_create_rule_invalid_signal_type(self, client):
        """Test creating a rule with invalid signal type returns 422."""
        payload = {
            "name": "Bad Rule",
            "signal_type": "invalid_type",
            "operator": ">",
            "threshold": 50.0,
        }
        response = client.post("/api/alerts/rules", json=payload)
        assert response.status_code == 422

    def test_create_rule_invalid_operator(self, client):
        """Test creating a rule with invalid operator returns 422."""
        payload = {
            "name": "Bad Rule",
            "signal_type": "velocity",
            "operator": "!=",
            "threshold": 50.0,
        }
        response = client.post("/api/alerts/rules", json=payload)
        assert response.status_code == 422

    def test_get_rule(self, client, test_db, mock_repo):
        """Test getting a specific rule by ID."""
        rule = _create_rule(test_db, mock_repo)
        response = client.get(f"/api/alerts/rules/{rule.id}")
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == rule.id
        assert data["name"] == rule.name
        assert data["signal_type"] == rule.signal_type

    def test_get_rule_not_found(self, client):
        """Test getting a nonexistent rule returns 404."""
        response = client.get("/api/alerts/rules/99999")
        assert response.status_code == 404

    def test_update_rule(self, client, test_db, mock_repo):
        """Test updating an existing rule."""
        rule = _create_rule(test_db, mock_repo)
        update_payload = {
            "name": "Updated Rule Name",
            "threshold": 200.0,
            "enabled": False,
        }
        response = client.patch(f"/api/alerts/rules/{rule.id}", json=update_payload)
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated Rule Name"
        assert data["threshold"] == pytest.approx(200.0)
        assert data["enabled"] is False
        # Other fields should remain unchanged
        assert data["signal_type"] == rule.signal_type
        assert data["operator"] == rule.operator

    def test_update_rule_not_found(self, client):
        """Test updating a nonexistent rule returns 404."""
        response = client.patch("/api/alerts/rules/99999", json={"name": "X"})
        assert response.status_code == 404

    def test_delete_rule(self, client, test_db, mock_repo):
        """Test deleting a rule."""
        rule = _create_rule(test_db, mock_repo)
        response = client.delete(f"/api/alerts/rules/{rule.id}")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "deleted"
        assert data["id"] == rule.id

        # Verify rule is actually deleted
        response = client.get(f"/api/alerts/rules/{rule.id}")
        assert response.status_code == 404

    def test_delete_rule_not_found(self, client):
        """Test deleting a nonexistent rule returns 404."""
        response = client.delete("/api/alerts/rules/99999")
        assert response.status_code == 404


class TestTriggeredAlerts:
    """Test cases for /api/alerts/triggered endpoints."""

    def test_list_triggered_empty(self, client):
        """Test listing triggered alerts when none exist."""
        response = client.get("/api/alerts/triggered")
        assert response.status_code == 200
        data = response.json()
        assert data == []

    def test_list_triggered_with_alerts(self, client, test_db, mock_repo):
        """Test listing triggered alerts."""
        rule = _create_rule(test_db, mock_repo)
        alert = _create_triggered_alert(test_db, rule, mock_repo)

        response = client.get("/api/alerts/triggered")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["id"] == alert.id
        assert data[0]["rule_id"] == rule.id
        assert data[0]["repo_id"] == mock_repo.id
        assert data[0]["rule_name"] == rule.name
        assert data[0]["repo_name"] == mock_repo.full_name
        assert data[0]["acknowledged"] is False

    def test_acknowledge_single_alert(self, client, test_db, mock_repo):
        """Test acknowledging a single triggered alert."""
        rule = _create_rule(test_db, mock_repo)
        alert = _create_triggered_alert(test_db, rule, mock_repo)

        response = client.post(f"/api/alerts/triggered/{alert.id}/acknowledge")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "acknowledged"
        assert data["id"] == alert.id

    def test_acknowledge_alert_not_found(self, client):
        """Test acknowledging a nonexistent alert returns 404."""
        response = client.post("/api/alerts/triggered/99999/acknowledge")
        assert response.status_code == 404

    def test_acknowledge_all_alerts(self, client, test_db, mock_repo):
        """Test acknowledging all unacknowledged alerts."""
        rule = _create_rule(test_db, mock_repo)
        _create_triggered_alert(test_db, rule, mock_repo)
        _create_triggered_alert(test_db, rule, mock_repo)

        response = client.post("/api/alerts/triggered/acknowledge-all")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "acknowledged"
        assert data["count"] == 2


class TestAlertCheck:
    """Test cases for POST /api/alerts/check."""

    def test_check_alerts_no_rules(self, client):
        """Test manual alert check with no rules returns empty."""
        response = client.post("/api/alerts/check")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "checked"
        assert data["triggered_count"] == 0
        assert data["triggered"] == []

    def test_check_alerts_with_matching_rule(self, client, test_db, mock_repo):
        """Test manual alert check that triggers matching rules."""
        from db.models import Signal
        # Create a signal that meets the rule condition
        signal = Signal(
            repo_id=mock_repo.id,
            signal_type=SignalType.STARS_DELTA_7D,
            value=200.0,
            calculated_at=utc_now(),
        )
        test_db.add(signal)
        test_db.commit()

        _create_rule(test_db, mock_repo, threshold=100.0, operator=">")

        response = client.post("/api/alerts/check")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "checked"
        assert data["triggered_count"] >= 1
        # Verify triggered alert structure
        if data["triggered_count"] > 0:
            triggered = data["triggered"][0]
            assert "id" in triggered
            assert "rule_id" in triggered
            assert "repo_id" in triggered
            assert "signal_value" in triggered
