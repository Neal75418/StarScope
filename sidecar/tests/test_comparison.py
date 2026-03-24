"""
Tests for comparison chart endpoint.
"""

from datetime import timedelta

from constants import SignalType
from db.models import RepoSnapshot, Signal
from utils.time import utc_now, utc_today


class TestComparisonEndpoint:
    """Test cases for POST /api/comparison/chart."""

    def test_requires_at_least_2_repos(self, client, mock_repo):
        """Test that fewer than 2 repos returns 422."""
        response = client.post("/api/comparison/chart", json={
            "repo_ids": [mock_repo.id],
        })
        assert response.status_code == 422

    def test_max_5_repos(self, client, mock_multiple_repos):
        """Test that more than 5 repos returns 422."""
        ids = [r.id for r in mock_multiple_repos]
        # mock_multiple_repos has 3, create extra IDs to exceed 5
        response = client.post("/api/comparison/chart", json={
            "repo_ids": ids + [9991, 9992, 9993],
        })
        assert response.status_code == 422

    def test_duplicate_repo_ids(self, client, mock_repo):
        """Test that duplicate repo IDs returns 422."""
        response = client.post("/api/comparison/chart", json={
            "repo_ids": [mock_repo.id, mock_repo.id],
        })
        assert response.status_code == 422

    def test_missing_repo(self, client, mock_repo):
        """Test that nonexistent repo ID returns 404."""
        response = client.post("/api/comparison/chart", json={
            "repo_ids": [mock_repo.id, 99999],
        })
        assert response.status_code == 404
        assert "not found" in response.json()["detail"]

    def test_comparison_chart_success(self, client, mock_multiple_repos, test_db):
        """Test successful comparison with data points."""
        repos = mock_multiple_repos[:2]
        today = utc_today()
        now = utc_now()

        for repo in repos:
            for i in range(5):
                snap = RepoSnapshot(
                    repo_id=repo.id,
                    snapshot_date=today - timedelta(days=4 - i),
                    fetched_at=now - timedelta(days=4 - i),
                    stars=1000 + i * 100 + repo.id * 10,
                    forks=50 + i * 5,
                    watchers=10, open_issues=2,
                )
                test_db.add(snap)
        test_db.commit()

        response = client.post("/api/comparison/chart", json={
            "repo_ids": [repos[0].id, repos[1].id],
            "time_range": "7d",
        })
        assert response.status_code == 200
        data = response.json()["data"]
        assert len(data["repos"]) == 2
        assert data["time_range"] == "7d"

        # Each repo should have data points
        for repo_data in data["repos"]:
            assert len(repo_data["data_points"]) == 5
            assert repo_data["color"].startswith("#")
            # Last snapshot stars = 1000 + 4*100 + repo_id*10
            assert repo_data["current_stars"] >= 1400

    def test_comparison_with_signals(self, client, mock_multiple_repos, test_db):
        """Test comparison includes signal data."""
        repos = mock_multiple_repos[:2]
        today = utc_today()
        now = utc_now()

        # Create snapshots
        for repo in repos:
            snap = RepoSnapshot(
                repo_id=repo.id,
                snapshot_date=today,
                fetched_at=now,
                stars=1000, forks=50, watchers=10, open_issues=2,
            )
            test_db.add(snap)

        # Create signals for first repo
        test_db.add(Signal(repo_id=repos[0].id, signal_type=SignalType.VELOCITY, value=25.5))
        test_db.add(Signal(repo_id=repos[0].id, signal_type="trend", value=1))
        test_db.commit()

        response = client.post("/api/comparison/chart", json={
            "repo_ids": [repos[0].id, repos[1].id],
        })
        assert response.status_code == 200
        data = response.json()["data"]

        # First repo should have velocity
        assert data["repos"][0]["velocity"] == 25.5
        assert data["repos"][0]["trend"] == 1
        # Second repo has no signals
        assert data["repos"][1]["velocity"] is None

    def test_normalize_mode(self, client, mock_multiple_repos, test_db):
        """Test normalized (percentage change) mode."""
        repos = mock_multiple_repos[:2]
        today = utc_today()
        now = utc_now()

        for repo in repos:
            for i in range(3):
                snap = RepoSnapshot(
                    repo_id=repo.id,
                    snapshot_date=today - timedelta(days=2 - i),
                    fetched_at=now - timedelta(days=2 - i),
                    stars=1000 + i * 100,
                    forks=50 + i * 5,
                    watchers=10, open_issues=2,
                )
                test_db.add(snap)
        test_db.commit()

        response = client.post("/api/comparison/chart", json={
            "repo_ids": [repos[0].id, repos[1].id],
            "normalize": True,
        })
        assert response.status_code == 200
        data = response.json()["data"]

        # First data point should be 0% (baseline)
        for repo_data in data["repos"]:
            assert repo_data["data_points"][0]["stars"] == 0

    def test_time_range_all(self, client, mock_multiple_repos, test_db):
        """Test 'all' time range includes all snapshots."""
        repos = mock_multiple_repos[:2]
        today = utc_today()
        now = utc_now()

        for repo in repos:
            for i in [180, 90, 0]:  # 180 days ago, 90 days ago, today
                snap = RepoSnapshot(
                    repo_id=repo.id,
                    snapshot_date=today - timedelta(days=i),
                    fetched_at=now - timedelta(days=i),
                    stars=1000 + (180 - i) * 10,
                    forks=50, watchers=10, open_issues=2,
                )
                test_db.add(snap)
        test_db.commit()

        response = client.post("/api/comparison/chart", json={
            "repo_ids": [repos[0].id, repos[1].id],
            "time_range": "all",
        })
        assert response.status_code == 200
        data = response.json()["data"]
        # Should have all 3 snapshots per repo
        for repo_data in data["repos"]:
            assert len(repo_data["data_points"]) == 3

    def test_invalid_time_range(self, client, mock_multiple_repos):
        """Test invalid time_range returns 422."""
        ids = [r.id for r in mock_multiple_repos[:2]]
        response = client.post("/api/comparison/chart", json={
            "repo_ids": ids,
            "time_range": "99d",
        })
        assert response.status_code == 422

    def test_colors_are_different(self, client, mock_multiple_repos, test_db):
        """Test each repo gets a distinct color."""
        repos = mock_multiple_repos
        today = utc_today()
        now = utc_now()

        for repo in repos:
            test_db.add(RepoSnapshot(
                repo_id=repo.id, snapshot_date=today, fetched_at=now,
                stars=1000, forks=50, watchers=10, open_issues=2,
            ))
        test_db.commit()

        ids = [r.id for r in repos]
        response = client.post("/api/comparison/chart", json={
            "repo_ids": ids,
        })
        data = response.json()["data"]
        colors = [r["color"] for r in data["repos"]]
        assert len(set(colors)) == len(colors)  # All unique
