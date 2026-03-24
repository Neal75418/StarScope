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
        # 驗證統一的 API 響應格式
        assert data["success"] is True
        assert data["data"]["repos"] == []
        assert data["data"]["total"] == 0
        assert data["data"]["sort_by"] == "velocity"
        assert "velocity" in data["message"]  # message 包含 sort_by 資訊

    def test_get_trends_with_sort(self, client):
        """Test getting trends with different sort options."""
        sort_options = ["velocity", "stars_delta_7d", "stars_delta_30d", "acceleration"]
        for sort_by in sort_options:
            response = client.get(f"/api/trends/?sort_by={sort_by}")
            assert response.status_code == 200
            data = response.json()
            # 驗證 message 中包含 sort_by 資訊
            assert data["success"] is True
            assert sort_by in data["message"]

    def test_get_trends_with_limit(self, client, test_db):
        """Test that limit parameter restricts the number of returned repos."""
        from db.models import Repo, Signal
        from utils.time import utc_now
        from constants import SignalType

        # Create 3 repos with velocity signals
        for i in range(3):
            repo = Repo(
                owner=f"org{i}", name=f"lib{i}", full_name=f"org{i}/lib{i}",
                url=f"https://github.com/org{i}/lib{i}",
                language="Python", added_at=utc_now(), updated_at=utc_now(),
            )
            test_db.add(repo)
            test_db.flush()
            test_db.add(Signal(
                repo_id=repo.id, signal_type=SignalType.VELOCITY,
                value=10.0 * (i + 1), calculated_at=utc_now(),
            ))
        test_db.commit()

        # Without limit — should return all 3
        resp_all = client.get("/api/trends/")
        assert resp_all.json()["data"]["total"] == 3

        # With limit=2 — should return at most 2
        resp_limited = client.get("/api/trends/?limit=2")
        assert resp_limited.status_code == 200
        data = resp_limited.json()
        assert data["success"] is True
        assert len(data["data"]["repos"]) == 2

    def test_get_trends_invalid_sort(self, client):
        """Test getting trends with invalid sort option returns validation error."""
        response = client.get("/api/trends/?sort_by=invalid")
        assert response.status_code == 422
