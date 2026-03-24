"""
Tests for recommendation endpoints.
"""


class TestRecommendationEndpoints:
    """Test cases for /api/recommendations endpoints."""

    def test_calculate_similarities_not_found(self, client):
        """Test calculating similarities for nonexistent repo."""
        response = client.post("/api/recommendations/repo/99999/calculate")
        assert response.status_code == 404

    def test_recalculate_all_similarities(self, client):
        """Test recalculating all similarities returns correct values for empty watchlist."""
        response = client.post("/api/recommendations/recalculate")
        assert response.status_code == 200
        response_data = response.json()
        assert response_data["success"] is True
        data = response_data["data"]
        assert data["total_repos"] == 0
        assert data["processed"] == 0
        assert data["similarities_found"] == 0

