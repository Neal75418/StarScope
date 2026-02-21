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
        # 驗證統一的 API 響應格式
        assert data["success"] is True
        assert data["data"]["signals"] == []
        assert data["data"]["total"] == 0

    def test_list_signals_with_filters(self, client):
        """Test listing signals with filter parameters."""
        response = client.get("/api/early-signals?signal_type=rising_star&severity=high")
        assert response.status_code == 200
        data = response.json()
        # 驗證統一的 API 響應格式
        assert data["success"] is True
        assert "signals" in data["data"]
        assert "total" in data["data"]

    def test_get_signal_summary(self, client):
        """Test getting signal summary statistics."""
        response = client.get("/api/early-signals/summary")
        assert response.status_code == 200
        data = response.json()
        # 驗證統一的 API 響應格式
        assert data["success"] is True
        summary = data["data"]
        assert "total_active" in summary
        assert "by_type" in summary
        assert "by_severity" in summary
        assert "repos_with_signals" in summary

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
        # 驗證統一的 API 響應格式
        assert data["success"] is True
        result = data["data"]
        assert "repos_scanned" in result
        assert "signals_detected" in result
        assert "by_type" in result

    def test_acknowledge_all_signals(self, client):
        """Test acknowledging all signals."""
        response = client.post("/api/early-signals/acknowledge-all")
        assert response.status_code == 200
        data = response.json()
        # 驗證統一的 API 響應格式
        assert data["success"] is True
        assert data["data"]["status"] == "ok"
