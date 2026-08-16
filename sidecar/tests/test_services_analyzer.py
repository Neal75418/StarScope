"""
Tests for services/analyzer.py - Signal calculation engine.
"""

import pytest
from datetime import date, timedelta

from db.models import RepoSnapshot
from utils.time import utc_today

from services.analyzer import (
    get_snapshot_for_date,
    calculate_delta,
    calculate_velocity,
    calculate_acceleration,
    calculate_trend,
    calculate_signals,
)


class TestCalculateTrend:
    """Tests for calculate_trend function."""

    def test_trend_upward_positive_velocity(self):
        """Test upward trend with positive velocity."""
        assert calculate_trend(5.0, 0.1) == 1

    def test_trend_upward_positive_velocity_no_acceleration(self):
        """Test upward trend with positive velocity and no acceleration data."""
        assert calculate_trend(1.0, None) == 1

    def test_trend_downward_negative_velocity(self):
        """Test downward trend with negative velocity."""
        assert calculate_trend(-1.0, 0.0) == -1

    def test_trend_downward_strong_negative_acceleration(self):
        """Test downward trend with strong negative acceleration."""
        assert calculate_trend(0.3, -0.5) == -1

    def test_trend_stable_low_velocity(self):
        """Test stable trend with low velocity."""
        assert calculate_trend(0.2, 0.0) == 0

    def test_trend_stable_zero_velocity(self):
        """Test stable trend with zero velocity."""
        assert calculate_trend(0.0, 0.0) == 0

    def test_trend_none_velocity(self):
        """Test stable when velocity is None."""
        assert calculate_trend(None, 0.5) == 0

    def test_trend_upward_strong_velocity_weak_negative_acceleration(self):
        """Test upward trend even with slightly negative acceleration."""
        assert calculate_trend(2.0, -0.05) == 1


class TestGetSnapshotForDate:
    """Tests for get_snapshot_for_date function."""

    def test_exact_match(self, test_db, mock_repo_with_snapshots):
        """Test getting snapshot with exact date match."""
        repo, snapshots = mock_repo_with_snapshots
        target_date = snapshots[0].snapshot_date

        result = get_snapshot_for_date(repo.id, target_date, test_db)
        assert result is not None
        assert result.snapshot_date == target_date

    def test_no_match_returns_none_when_not_allowing_earlier(self, test_db, mock_repo):
        """Test returns None when no exact match and not allowing earlier."""
        future_date = utc_today() + timedelta(days=100)
        result = get_snapshot_for_date(mock_repo.id, future_date, test_db, allow_earlier=False)
        assert result is None

    def test_returns_earlier_snapshot_when_allowed(self, test_db, mock_repo_with_snapshots):
        """Test returns earlier snapshot when exact match not found."""
        repo, snapshots = mock_repo_with_snapshots
        # Request a date between snapshots
        future_date = utc_today() + timedelta(days=1)
        result = get_snapshot_for_date(repo.id, future_date, test_db, allow_earlier=True)
        assert result is not None
        # 回傳的 snapshot 日期不應超過目標日期
        assert result.snapshot_date <= future_date
        # 應回傳最近的 snapshot（最大日期）
        latest_date = max(s.snapshot_date for s in snapshots)
        assert result.snapshot_date == latest_date


class TestCalculateDelta:
    """Tests for calculate_delta function."""

    def test_calculate_delta_with_snapshots(self, test_db, mock_repo_with_snapshots):
        """Test delta calculation with historical data."""
        repo, _ = mock_repo_with_snapshots
        delta = calculate_delta(repo.id, 7, test_db)
        # Snapshots: day -30 to today (day 0), 50 stars/day growth
        # Day 0: 2500 stars, Day -7: 2150 stars → delta = 350
        assert delta == 350

    def test_calculate_delta_no_data(self, test_db, mock_repo):
        """Test delta calculation with no snapshot data."""
        result = calculate_delta(mock_repo.id, 7, test_db)
        assert result is None


class TestCalculateVelocity:
    """Tests for calculate_velocity function."""

    def test_calculate_velocity_with_data(self, test_db, mock_repo_with_snapshots):
        """Test velocity calculation."""
        repo, _ = mock_repo_with_snapshots
        velocity = calculate_velocity(repo.id, test_db, days=7)
        # 350 stars over 7 days = 50 stars/day
        assert velocity == pytest.approx(350.0 / 7)

    def test_calculate_velocity_no_data(self, test_db, mock_repo):
        """Test velocity returns None with no data."""
        result = calculate_velocity(mock_repo.id, test_db)
        assert result is None


class TestCalculateAcceleration:
    """Tests for calculate_acceleration function."""

    def test_calculate_acceleration_with_data(self, test_db, mock_repo_with_snapshots):
        """Test acceleration calculation."""
        repo, _ = mock_repo_with_snapshots
        acceleration = calculate_acceleration(repo.id, test_db)
        # Linear growth with constant 50 stars/day
        # this_week (day 0 to day -7): 350 stars / 7 = 50 stars/day
        # last_week (day -7 to day -14): 350 stars / 7 = 50 stars/day
        # acceleration = (50 - 50) / 50 = 0
        assert acceleration == pytest.approx(0.0)

    def test_calculate_acceleration_no_data(self, test_db, mock_repo):
        """Test acceleration returns None with no data."""
        result = calculate_acceleration(mock_repo.id, test_db)
        assert result is None


class TestCalculateSignals:
    """Tests for calculate_signals function."""

    def test_calculate_signals_stores_to_db(self, test_db, mock_repo_with_snapshots):
        """Test that signals are stored in database."""
        from db.models import Signal

        repo, _ = mock_repo_with_snapshots
        signals = calculate_signals(repo.id, test_db)

        # Check signals were returned
        assert isinstance(signals, dict)

        # Check signals were stored in DB (one per SignalType)
        db_signals = test_db.query(Signal).filter(Signal.repo_id == repo.id).all()
        assert len(db_signals) >= 1
        signal_types = {s.signal_type for s in db_signals}
        # Core signal types must always be present
        assert "velocity" in signal_types
        assert "stars_delta_7d" in signal_types

    def test_calculate_signals_upsert(self, test_db, mock_repo_with_snapshots):
        """Test that signals are upserted (not duplicated)."""
        from db.models import Signal

        repo, _ = mock_repo_with_snapshots

        # Calculate signals twice
        calculate_signals(repo.id, test_db)
        calculate_signals(repo.id, test_db)

        # Should have no duplicate signal types after two calculations
        db_signals = test_db.query(Signal).filter(Signal.repo_id == repo.id).all()
        signal_types = [s.signal_type for s in db_signals]
        assert len(signal_types) >= 1, "Expected at least one signal to be stored"
        assert len(signal_types) == len(set(signal_types))  # No duplicates


class TestBacktrackScalesWithWindow:
    """回溯上限寫死七天時，單日窗會拿七天前的快照冒充「一天」。

    段二的排行完全按相對成長排序，被放大七倍的成長會直接變成假的第一名，
    而畫面上看不出任何異常。
    """

    def _snap(self, day: date, stars: int) -> RepoSnapshot:
        return RepoSnapshot(repo_id=1, stars=stars, forks=0,
                            watchers=0, open_issues=0, snapshot_date=day)

    def test_one_day_window_requires_an_exact_match(self, test_db):
        today = utc_today()
        # 今天有、昨天沒有、七天前有
        snap_by_date = {
            today: self._snap(today, 1000),
            today - timedelta(days=7): self._snap(today - timedelta(days=7), 100),
        }

        result = calculate_delta(1, 1, test_db, snap_by_date=snap_by_date)

        assert result is None, "昨天沒有快照時應回 None，不得拿七天前的來比"

    def test_one_day_window_works_when_yesterday_exists(self, test_db):
        today = utc_today()
        snap_by_date = {
            today: self._snap(today, 1000),
            today - timedelta(days=1): self._snap(today - timedelta(days=1), 900),
        }

        assert calculate_delta(1, 1, test_db, snap_by_date=snap_by_date) == 100.0

    def test_seven_day_window_backtracks_at_most_three_days(self, test_db):
        today = utc_today()
        # 目標是 today-7，往前三天內（today-8..today-10）有；再更早的不算
        near = {today: self._snap(today, 1000),
                today - timedelta(days=10): self._snap(today - timedelta(days=10), 500)}
        far = {today: self._snap(today, 1000),
               today - timedelta(days=11): self._snap(today - timedelta(days=11), 500)}

        assert calculate_delta(1, 7, test_db, snap_by_date=near) == 500.0
        assert calculate_delta(1, 7, test_db, snap_by_date=far) is None

    def test_thirty_day_window_keeps_the_existing_seven_day_cap(self, test_db):
        """days // 2 會把三十日窗放寬到十五天回溯；min(..., 7) 必須擋住。"""
        today = utc_today()
        at_cap = {today: self._snap(today, 1000),
                  today - timedelta(days=37): self._snap(today - timedelta(days=37), 500)}
        beyond = {today: self._snap(today, 1000),
                  today - timedelta(days=38): self._snap(today - timedelta(days=38), 500)}

        assert calculate_delta(1, 30, test_db, snap_by_date=at_cap) == 500.0
        assert calculate_delta(1, 30, test_db, snap_by_date=beyond) is None
