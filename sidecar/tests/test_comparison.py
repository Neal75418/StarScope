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


class TestNormalizeWithZeroBase:
    """
    正規化的基期為 0 時算不出百分比，要回 None 而不是 0。

    0 讀起來是「完全沒變」，跟「算不出來」是兩件事。實測 2026-08-15 有兩個
    追蹤中的 repo 的 open_issues 是 0（deepseek-harness、doocs/advanced-java），
    舊寫法會在 Issue 視圖上畫出一條假的水平 0 線。
    """

    def _seed(self, test_db, base_issues: int, later_issues: int, slug: str = "a"):
        from datetime import date
        from db.models import Repo, RepoSnapshot
        from utils.time import utc_now

        repo = Repo(owner=slug, name="r", full_name=f"{slug}/r", url=f"https://github.com/{slug}/r",
                    added_at=utc_now(), updated_at=utc_now())
        test_db.add(repo)
        test_db.flush()
        test_db.add_all([
            RepoSnapshot(repo_id=repo.id, stars=100, forks=10,
                         open_issues=base_issues, snapshot_date=date(2026, 8, 15)),
            RepoSnapshot(repo_id=repo.id, stars=150, forks=20,
                         open_issues=later_issues, snapshot_date=date(2026, 8, 16)),
        ])
        test_db.commit()
        return repo

    def _chart(self, client, repo_ids, normalize=True):
        resp = client.post("/api/comparison/chart", json={
            "repo_ids": repo_ids, "time_range": "all", "normalize": normalize})
        assert resp.status_code == 200, resp.text
        return resp.json()["data"]["repos"]

    def test_zero_base_yields_null_not_zero(self, client, test_db):
        repo = self._seed(test_db, base_issues=0, later_issues=7)
        other = self._seed(test_db, base_issues=5, later_issues=6, slug="b")

        repos = self._chart(client, [repo.id, other.id])
        target = next(r for r in repos if r["repo_id"] == repo.id)

        issues = [p["open_issues"] for p in target["data_points"]]
        assert issues == [None, None], "基期為 0 卻回了數字，圖上會出現一條假的 0 線"

    def test_nonzero_base_still_computes_percent(self, client, test_db):
        repo = self._seed(test_db, base_issues=5, later_issues=6)
        other = self._seed(test_db, base_issues=5, later_issues=5, slug="b")

        repos = self._chart(client, [repo.id, other.id])
        target = next(r for r in repos if r["repo_id"] == repo.id)

        # 5 → 6 是 +20%
        assert [p["open_issues"] for p in target["data_points"]] == [0.0, 20.0]

    def test_genuine_no_change_is_zero_not_null(self, client, test_db):
        """真的沒變化要回 0——修法不能把「沒變」也變成「算不出來」。"""
        repo = self._seed(test_db, base_issues=5, later_issues=5)
        other = self._seed(test_db, base_issues=5, later_issues=6, slug="b")

        repos = self._chart(client, [repo.id, other.id])
        target = next(r for r in repos if r["repo_id"] == repo.id)

        assert [p["open_issues"] for p in target["data_points"]] == [0.0, 0.0]

    def test_unnormalized_zero_stays_zero(self, client, test_db):
        """沒開正規化時 0 就是 0，不該被改成 None。"""
        repo = self._seed(test_db, base_issues=0, later_issues=7)
        other = self._seed(test_db, base_issues=5, later_issues=6, slug="b")

        repos = self._chart(client, [repo.id, other.id], normalize=False)
        target = next(r for r in repos if r["repo_id"] == repo.id)

        assert [p["open_issues"] for p in target["data_points"]] == [0, 7]
