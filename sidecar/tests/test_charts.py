"""
Tests for chart endpoints.
"""


class TestChartEndpoints:
    """Test cases for /api/charts endpoints."""

    def test_get_stars_chart_not_found(self, client):
        """Test getting star chart for nonexistent repo."""
        response = client.get("/api/charts/99999/stars")
        assert response.status_code == 404

    def test_get_stars_chart_valid_time_ranges(self, client, mock_repo_with_snapshots):
        """Test that valid time_range values are accepted with real data."""
        repo, _ = mock_repo_with_snapshots
        for time_range in ["7d", "30d", "90d"]:
            response = client.get(f"/api/charts/{repo.id}/stars?time_range={time_range}")
            assert response.status_code == 200

    def test_get_stars_chart_invalid_time_range(self, client, mock_repo_with_snapshots):
        """Test that invalid time_range returns 422."""
        repo, _ = mock_repo_with_snapshots
        response = client.get(f"/api/charts/{repo.id}/stars?time_range=invalid")
        assert response.status_code == 422
