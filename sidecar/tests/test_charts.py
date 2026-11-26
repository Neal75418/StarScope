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

    def test_each_range_covers_its_days(self, client, test_db, mock_repo):
        """31 天的 fixture 分不出 30d 與 90d：放 120 天，三個範圍各自含今天往回 N 天"""
        from datetime import timedelta
        from unittest.mock import patch
        from db.models import RepoSnapshot
        from utils.time import utc_now, utc_today

        # 「今天」只算一次、端點也用同一天：跨 UTC 午夜時才不會撞唯一鍵或多算一天
        today = utc_today()
        for i in range(120):
            test_db.add(RepoSnapshot(
                repo_id=mock_repo.id, stars=1000 + i, forks=0, watchers=0, open_issues=0,
                snapshot_date=today - timedelta(days=i), fetched_at=utc_now(),
            ))
        test_db.commit()

        with patch("routers.charts.utc_today", return_value=today):
            for time_range, expected in {"7d": 8, "30d": 31, "90d": 91}.items():
                data = client.get(f"/api/charts/{mock_repo.id}/stars?time_range={time_range}").json()["data"]
                assert len(data["data_points"]) == expected, time_range

    def test_get_stars_chart_invalid_time_range(self, client, mock_repo_with_snapshots):
        """Test that invalid time_range returns 422."""
        repo, _ = mock_repo_with_snapshots
        response = client.get(f"/api/charts/{repo.id}/stars?time_range=invalid")
        assert response.status_code == 422

    def test_all_is_not_offered(self, client, mock_repo_with_snapshots):
        """圖表只有 7d／30d／90d：「全部」由 star-history 端點提供，不走這支。
        OpenAPI 不能把 all 列成合法值，送了也和其他不合法的值一樣回 422，訊息列出可收的值"""
        repo, _ = mock_repo_with_snapshots
        response = client.get(f"/api/charts/{repo.id}/stars?time_range=all")
        assert response.status_code == 422
        assert response.json()["detail"] == "time_range: Input should be '7d', '30d' or '90d'"

        params = client.app.openapi()["paths"]["/api/charts/{repo_id}/stars"]["get"]["parameters"]
        time_range = next(p for p in params if p["name"] == "time_range")
        assert time_range["schema"]["enum"] == ["7d", "30d", "90d"]
        assert time_range["schema"]["default"] == "30d"
