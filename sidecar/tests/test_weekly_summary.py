"""
Tests for weekly summary endpoint and service.
"""

from datetime import timedelta

from constants import SignalType
from db.models import RepoSnapshot, TriggeredAlert, AlertRule, EarlySignal, ContextSignal
from utils.time import utc_now, utc_today


class TestWeeklySummaryEndpoint:
    """Test cases for GET /api/summary/weekly."""

    def test_empty_watchlist(self, client):
        """Test weekly summary with no repos."""
        response = client.get("/api/summary/weekly")
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total_repos"] == 0
        assert data["total_new_stars"] == 0
        assert data["top_gainers"] == []
        assert data["top_losers"] == []
        assert data["alerts_triggered"] == 0
        assert data["early_signals_detected"] == 0
        assert data["hn_mentions"] == []

    def test_with_repo_and_snapshots(self, client, mock_repo, test_db):
        """Test weekly summary correctly calculates star deltas."""
        today = utc_today()
        now = utc_now()

        # Old snapshot (8 days ago) — just outside the window
        old_snap = RepoSnapshot(
            repo_id=mock_repo.id,
            snapshot_date=today - timedelta(days=8),
            fetched_at=now - timedelta(days=8),
            stars=1000, forks=50, watchers=10, open_issues=5,
        )
        # Latest snapshot (today)
        new_snap = RepoSnapshot(
            repo_id=mock_repo.id,
            snapshot_date=today,
            fetched_at=now,
            stars=1200, forks=55, watchers=12, open_issues=4,
        )
        test_db.add_all([old_snap, new_snap])
        test_db.commit()

        response = client.get("/api/summary/weekly")
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total_repos"] == 1
        assert data["total_new_stars"] == 200  # 1200 - 1000
        assert len(data["top_gainers"]) == 1
        assert data["top_gainers"][0]["stars_delta_7d"] == 200

    def test_top_losers(self, client, mock_repo, test_db):
        """Test that repos with negative delta appear in top_losers."""
        today = utc_today()
        now = utc_now()

        old_snap = RepoSnapshot(
            repo_id=mock_repo.id,
            snapshot_date=today - timedelta(days=8),
            fetched_at=now - timedelta(days=8),
            stars=1000, forks=50, watchers=10, open_issues=5,
        )
        new_snap = RepoSnapshot(
            repo_id=mock_repo.id,
            snapshot_date=today,
            fetched_at=now,
            stars=900, forks=50, watchers=10, open_issues=5,
        )
        test_db.add_all([old_snap, new_snap])
        test_db.commit()

        response = client.get("/api/summary/weekly")
        data = response.json()["data"]
        assert data["total_new_stars"] == -100
        assert len(data["top_losers"]) == 1
        assert data["top_losers"][0]["stars_delta_7d"] == -100
        assert data["top_gainers"] == []

    def test_alerts_triggered_count(self, client, mock_repo, test_db):
        """Test counting alerts triggered this week."""
        now = utc_now()

        rule = AlertRule(
            name="Test Rule",
            signal_type=SignalType.VELOCITY,
            operator=">",
            threshold=10.0,
        )
        test_db.add(rule)
        test_db.flush()

        # Recent alert (within 7 days)
        recent_alert = TriggeredAlert(
            rule_id=rule.id,
            repo_id=mock_repo.id,
            signal_value=50.0,
            triggered_at=now - timedelta(days=1),
        )
        # Old alert (outside 7 days)
        old_alert = TriggeredAlert(
            rule_id=rule.id,
            repo_id=mock_repo.id,
            signal_value=30.0,
            triggered_at=now - timedelta(days=10),
        )
        test_db.add_all([recent_alert, old_alert])
        test_db.commit()

        response = client.get("/api/summary/weekly")
        data = response.json()["data"]
        assert data["alerts_triggered"] == 1

    def test_early_signals_by_type(self, client, mock_repo, test_db):
        """Test early signals grouped by type."""
        now = utc_now()

        signals = [
            EarlySignal(
                repo_id=mock_repo.id, signal_type="rising_star", severity="high",
                description="Rising", detected_at=now - timedelta(days=1),
            ),
            EarlySignal(
                repo_id=mock_repo.id, signal_type="rising_star", severity="medium",
                description="Rising 2", detected_at=now - timedelta(days=2),
            ),
            EarlySignal(
                repo_id=mock_repo.id, signal_type="sudden_spike", severity="high",
                description="Spike", detected_at=now - timedelta(days=1),
            ),
            # Old signal — should NOT be counted
            EarlySignal(
                repo_id=mock_repo.id, signal_type="breakout", severity="low",
                description="Old", detected_at=now - timedelta(days=10),
            ),
        ]
        test_db.add_all(signals)
        test_db.commit()

        response = client.get("/api/summary/weekly")
        data = response.json()["data"]
        assert data["early_signals_detected"] == 3
        assert data["early_signals_by_type"]["rising_star"] == 2
        assert data["early_signals_by_type"]["sudden_spike"] == 1
        assert "breakout" not in data["early_signals_by_type"]

    def test_hn_mentions(self, client, mock_repo, test_db):
        """Test HN mentions in weekly summary."""
        now = utc_now()

        hn = ContextSignal(
            repo_id=mock_repo.id,
            signal_type="hacker_news",
            external_id="hn_12345",
            title="Show HN: TestRepo",
            url="https://news.ycombinator.com/item?id=12345",
            score=150,
            comment_count=42,
            fetched_at=now - timedelta(days=1),
        )
        test_db.add(hn)
        test_db.commit()

        response = client.get("/api/summary/weekly")
        data = response.json()["data"]
        assert len(data["hn_mentions"]) == 1
        assert data["hn_mentions"][0]["hn_title"] == "Show HN: TestRepo"
        assert data["hn_mentions"][0]["hn_score"] == 150

    def test_accelerating_decelerating(self, client, mock_repo, test_db):
        """Test accelerating/decelerating repo counts."""
        from db.models import Signal

        signals = [
            Signal(repo_id=mock_repo.id, signal_type="acceleration", value=5.0),
        ]
        test_db.add_all(signals)
        test_db.commit()

        response = client.get("/api/summary/weekly")
        data = response.json()["data"]
        assert data["accelerating"] == 1
        assert data["decelerating"] == 0

    def test_period_dates(self, client):
        """Test that period_start and period_end are valid ISO dates."""
        response = client.get("/api/summary/weekly")
        data = response.json()["data"]
        assert "period_start" in data
        assert "period_end" in data
        # Should be parseable ISO date strings
        from datetime import date
        date.fromisoformat(data["period_start"])
        date.fromisoformat(data["period_end"])


class TestReposComparedDistinguishesNoDataFromNoChange:
    """total_new_stars 是 0 有兩種完全不同的原因，回應必須分得出來。

    實測時使用者的快照只有兩天，7 天前那一端撈不到任何東西，repo_deltas 是空的，
    sum({}) 就是 0——畫面因此顯示「0 近 7 天新增星數」「近 7 天無變動」，
    而同一個畫面的健康分數已經改口說「快照累積中」。
    """

    def test_no_baseline_reports_nothing_compared(self, test_db):
        from db.models import Repo
        from services.weekly_summary import get_weekly_summary
        repo = Repo(owner="a", name="b", full_name="a/b",
                    url="https://github.com/a/b", github_id=1)
        test_db.add(repo)
        test_db.flush()
        # 只有最近兩天，沒有 7 天前那一端
        today = utc_today()
        test_db.add_all([
            RepoSnapshot(repo_id=repo.id, stars=100, forks=1, snapshot_date=today - timedelta(days=1)),
            RepoSnapshot(repo_id=repo.id, stars=150, forks=1, snapshot_date=today),
        ])
        test_db.commit()

        result = get_weekly_summary(test_db)

        assert result["repos_compared"] == 0
        assert result["total_new_stars"] == 0, "沒有基準線時總和仍是 0，這正是要靠另一個欄位分辨的原因"

    def test_a_real_baseline_is_counted(self, test_db):
        from db.models import Repo
        from services.weekly_summary import get_weekly_summary
        repo = Repo(owner="a", name="c", full_name="a/c",
                    url="https://github.com/a/c", github_id=2)
        test_db.add(repo)
        test_db.flush()
        today = utc_today()
        test_db.add_all([
            RepoSnapshot(repo_id=repo.id, stars=100, forks=1, snapshot_date=today - timedelta(days=8)),
            RepoSnapshot(repo_id=repo.id, stars=180, forks=1, snapshot_date=today),
        ])
        test_db.commit()

        result = get_weekly_summary(test_db)

        assert result["repos_compared"] == 1
        assert result["total_new_stars"] == 80
