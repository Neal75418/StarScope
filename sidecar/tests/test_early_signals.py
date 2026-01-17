"""
Tests for early signals endpoints.
"""


class TestEarlySignalsEndpoints:
    """Test cases for /api/early-signals endpoints."""

    def test_list_signals_empty(self, client):
        """Test listing signals when none exist."""
        response = client.get("/api/early-signals")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0
        assert data["signals"] == []

    def test_list_signals_with_filters(self, client):
        """Test listing signals with filter parameters."""
        response = client.get("/api/early-signals?signal_type=rising_star&severity=high")
        assert response.status_code == 200
        data = response.json()
        assert "signals" in data
        assert "total" in data

    def test_get_signal_summary(self, client):
        """Test getting signal summary statistics."""
        response = client.get("/api/early-signals/summary")
        assert response.status_code == 200
        data = response.json()
        assert "total_active" in data
        assert "by_type" in data
        assert "by_severity" in data
        assert "repos_with_signals" in data

    def test_get_repo_signals_not_found(self, client):
        """Test getting signals for nonexistent repo."""
        response = client.get("/api/early-signals/repo/99999")
        assert response.status_code == 404

    def test_acknowledge_signal_not_found(self, client):
        """Test acknowledging a nonexistent signal."""
        response = client.post("/api/early-signals/99999/acknowledge")
        assert response.status_code == 404

    def test_delete_signal_not_found(self, client):
        """Test deleting a nonexistent signal."""
        response = client.delete("/api/early-signals/99999")
        assert response.status_code == 404

    def test_trigger_detection(self, client):
        """Test triggering anomaly detection."""
        response = client.post("/api/early-signals/detect")
        assert response.status_code == 200
        data = response.json()
        assert "repos_scanned" in data
        assert "signals_detected" in data
        assert "by_type" in data

    def test_acknowledge_all_signals(self, client):
        """Test acknowledging all signals."""
        response = client.post("/api/early-signals/acknowledge-all")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
