"""
Tests for weekly summary endpoint and service.
"""

from datetime import timedelta

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
            signal_type="star_velocity",
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
