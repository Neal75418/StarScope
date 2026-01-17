"""
Tests for recommendation endpoints.
"""


class TestRecommendationEndpoints:
    """Test cases for /api/recommendations endpoints."""

    def test_get_similar_repos_not_found(self, client):
        """Test getting similar repos for nonexistent repo."""
        response = client.get("/api/recommendations/similar/99999")
        assert response.status_code == 404

    def test_get_similar_repos_with_limit(self, client):
        """Test getting similar repos with limit parameter."""
        response = client.get("/api/recommendations/similar/99999?limit=5")
        assert response.status_code == 404  # Repo doesn't exist

    def test_calculate_similarities_not_found(self, client):
        """Test calculating similarities for nonexistent repo."""
        response = client.post("/api/recommendations/repo/99999/calculate")
        assert response.status_code == 404

    def test_recalculate_all_similarities(self, client):
        """Test recalculating all similarities."""
        response = client.post("/api/recommendations/recalculate")
        assert response.status_code == 200
        data = response.json()
        assert "total_repos" in data
        assert "processed" in data
        assert "similarities_found" in data

    def test_get_recommendation_stats(self, client):
        """Test getting recommendation statistics."""
        response = client.get("/api/recommendations/stats")
        assert response.status_code == 200
        data = response.json()
        assert "total_repos" in data
        assert "total_similarity_pairs" in data
        assert "repos_with_recommendations" in data
        assert "average_similarity_score" in data
