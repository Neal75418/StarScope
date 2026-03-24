"""
Tests for early signals endpoints.
"""

from db.models import EarlySignal
from utils.time import utc_now


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

    def test_list_signals_with_filters(self, client, test_db, mock_repo):
        """Test that filters correctly include/exclude signals by type and severity."""
        # Create two signals with different type/severity
        signal_match = EarlySignal(
            repo_id=mock_repo.id,
            signal_type="rising_star",
            severity="high",
            description="Matching signal",
            velocity_value=50.0,
            star_count=1000,
            percentile_rank=85.0,
            detected_at=utc_now(),
        )
        signal_no_match = EarlySignal(
            repo_id=mock_repo.id,
            signal_type="breakout",
            severity="medium",
            description="Non-matching signal",
            velocity_value=20.0,
            star_count=500,
            percentile_rank=60.0,
            detected_at=utc_now(),
        )
        test_db.add_all([signal_match, signal_no_match])
        test_db.commit()

        # Filter by rising_star + high — should return only the matching signal
        response = client.get("/api/early-signals?signal_type=rising_star&severity=high")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["total"] == 1
        assert data["data"]["signals"][0]["signal_type"] == "rising_star"
        assert data["data"]["signals"][0]["severity"] == "high"

    def test_get_signal_summary(self, client):
        """Test getting signal summary returns correct values for empty DB."""
        response = client.get("/api/early-signals/summary")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        summary = data["data"]
        assert summary["total_active"] == 0
        assert summary["by_type"] == {}
        assert summary["by_severity"] == {}
        assert summary["repos_with_signals"] == 0

    def test_get_repo_signals_not_found(self, client):
        """Test getting signals for nonexistent repo."""
        response = client.get("/api/early-signals/repo/99999")
        assert response.status_code == 404

    def test_acknowledge_signal_not_found(self, client):
        """Test acknowledging a nonexistent signal."""
        response = client.post("/api/early-signals/99999/acknowledge")
        assert response.status_code == 404

