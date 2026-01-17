"""
Tests for health score endpoints.
"""


class TestHealthScoreEndpoints:
    """Test cases for /api/health-score endpoints."""

    def test_get_health_score_not_found(self, client):
        """Test getting health score for nonexistent repo."""
        response = client.get("/api/health-score/99999")
        assert response.status_code == 404

    def test_get_health_score_summary_not_found(self, client):
        """Test getting health score summary for nonexistent repo."""
        response = client.get("/api/health-score/99999/summary")
        assert response.status_code == 404

    def test_calculate_health_score_not_found(self, client):
        """Test calculating health score for nonexistent repo."""
        response = client.post("/api/health-score/99999/calculate")
        assert response.status_code == 404
