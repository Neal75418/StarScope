"""
Tests for trends endpoints.
"""


class TestTrendsEndpoints:
    """Test cases for /api/trends endpoints."""

    def test_get_trends_empty(self, client):
        """Test getting trends when no repos exist."""
        response = client.get("/api/trends/")
        assert response.status_code == 200
        data = response.json()
        assert data["repos"] == []
        assert data["total"] == 0
        assert "sort_by" in data

    def test_get_trends_with_sort(self, client):
        """Test getting trends with different sort options."""
        sort_options = ["velocity", "stars_delta_7d", "stars_delta_30d", "acceleration"]
        for sort_by in sort_options:
            response = client.get(f"/api/trends/?sort_by={sort_by}")
            assert response.status_code == 200
            data = response.json()
            assert data["sort_by"] == sort_by

    def test_get_trends_with_limit(self, client):
        """Test getting trends with limit parameter."""
        response = client.get("/api/trends/?limit=10")
        assert response.status_code == 200
        data = response.json()
        assert "repos" in data

    def test_get_trends_invalid_sort(self, client):
        """Test getting trends with invalid sort option."""
        response = client.get("/api/trends/?sort_by=invalid")
        # Should either use default or return an error
        assert response.status_code in [200, 400, 422]
