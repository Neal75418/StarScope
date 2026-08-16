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
        """Test that valid time_range values return real data points, not just 200."""
        repo, _ = mock_repo_with_snapshots
        # fixture: 31 天快照（day -30 to 0），stars 從 1000 線性長到 2500
        expected_points = {"7d": 8, "30d": 31, "90d": 31}
        for time_range, expected in expected_points.items():
            response = client.get(f"/api/charts/{repo.id}/stars?time_range={time_range}")
            assert response.status_code == 200
            data = response.json()["data"]
            assert data["repo_id"] == repo.id
            assert data["time_range"] == time_range
            assert len(data["data_points"]) == expected
            # 資料點按時間遞增、數值與 fixture 一致
            stars = [p["stars"] for p in data["data_points"]]
            assert stars == sorted(stars)
            assert data["min_stars"] == stars[0]
            assert data["max_stars"] == stars[-1] == 2500

    def test_get_stars_chart_invalid_time_range(self, client, mock_repo_with_snapshots):
        """Test that invalid time_range returns 422."""
        repo, _ = mock_repo_with_snapshots
        response = client.get(f"/api/charts/{repo.id}/stars?time_range=invalid")
        assert response.status_code == 422
