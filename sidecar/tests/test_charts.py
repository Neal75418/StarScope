"""
Tests for chart endpoints.
"""


class TestChartEndpoints:
    """Test cases for /api/charts endpoints."""

    def test_get_stars_chart_not_found(self, client):
        """Test getting star chart for nonexistent repo."""
        response = client.get("/api/charts/99999/stars")
        assert response.status_code == 404

    def test_get_stars_chart_with_time_range(self, client):
        """Test getting star chart with different time ranges."""
        time_ranges = ["7d", "30d", "90d"]
        for time_range in time_ranges:
            response = client.get(f"/api/charts/99999/stars?time_range={time_range}")
            assert response.status_code == 404  # Repo doesn't exist, but tests param parsing
