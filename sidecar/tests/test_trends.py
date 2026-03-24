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

    def test_get_trends_with_sort(self, client, test_db):
        """Test that sort_by parameter changes the result ordering."""
        from db.models import Repo, Signal
        from utils.time import utc_now
        from constants import SignalType

        # Create 2 repos: repo_a has higher velocity, repo_b has higher stars_delta_7d
        repo_a = Repo(
            owner="alpha", name="fast", full_name="alpha/fast",
            url="https://github.com/alpha/fast",
            language="Python", added_at=utc_now(), updated_at=utc_now(),
        )
        repo_b = Repo(
            owner="beta", name="popular", full_name="beta/popular",
            url="https://github.com/beta/popular",
            language="Python", added_at=utc_now(), updated_at=utc_now(),
        )
        test_db.add_all([repo_a, repo_b])
        test_db.flush()

        # repo_a: velocity=100, stars_delta_7d=10
        test_db.add(Signal(repo_id=repo_a.id, signal_type=SignalType.VELOCITY, value=100.0, calculated_at=utc_now()))
        test_db.add(Signal(repo_id=repo_a.id, signal_type=SignalType.STARS_DELTA_7D, value=10.0, calculated_at=utc_now()))
        # repo_b: velocity=20, stars_delta_7d=500
        test_db.add(Signal(repo_id=repo_b.id, signal_type=SignalType.VELOCITY, value=20.0, calculated_at=utc_now()))
        test_db.add(Signal(repo_id=repo_b.id, signal_type=SignalType.STARS_DELTA_7D, value=500.0, calculated_at=utc_now()))
        test_db.commit()

        # Sort by velocity — alpha/fast should be first
        resp_vel = client.get("/api/trends/?sort_by=velocity")
        repos_vel = resp_vel.json()["data"]["repos"]
        assert len(repos_vel) == 2, f"Expected 2 repos, got {len(repos_vel)}"
        assert repos_vel[0]["full_name"] == "alpha/fast"

        # Sort by stars_delta_7d — beta/popular should be first
        resp_delta = client.get("/api/trends/?sort_by=stars_delta_7d")
        repos_delta = resp_delta.json()["data"]["repos"]
        assert len(repos_delta) == 2, f"Expected 2 repos, got {len(repos_delta)}"
        assert repos_delta[0]["full_name"] == "beta/popular"

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
