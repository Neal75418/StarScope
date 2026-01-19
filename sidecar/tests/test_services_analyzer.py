"""
Tests for services/analyzer.py - Signal calculation engine.
"""

import pytest
from datetime import date, timedelta
from unittest.mock import MagicMock, patch

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
        future_date = date.today() + timedelta(days=100)
        result = get_snapshot_for_date(mock_repo.id, future_date, test_db, allow_earlier=False)
        assert result is None

    def test_returns_earlier_snapshot_when_allowed(self, test_db, mock_repo_with_snapshots):
        """Test returns earlier snapshot when exact match not found."""
        repo, snapshots = mock_repo_with_snapshots
        # Request a date between snapshots
        future_date = date.today() + timedelta(days=1)
        result = get_snapshot_for_date(repo.id, future_date, test_db, allow_earlier=True)
        assert result is not None


class TestCalculateDelta:
    """Tests for calculate_delta function."""

    def test_calculate_delta_with_snapshots(self, test_db, mock_repo_with_snapshots):
        """Test delta calculation with historical data."""
        repo, _ = mock_repo_with_snapshots
        delta = calculate_delta(repo.id, 7, test_db)
        # With snapshots growing by 50 stars per day, 7 days should be ~350
        assert delta is not None
        assert delta >= 0

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
        assert velocity is not None
        assert velocity >= 0

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
        # With consistent growth, acceleration should be near 0
        assert acceleration is not None

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

        # Check signals were stored in DB
        db_signals = test_db.query(Signal).filter(Signal.repo_id == repo.id).all()
        assert len(db_signals) > 0

    def test_calculate_signals_upsert(self, test_db, mock_repo_with_snapshots):
        """Test that signals are upserted (not duplicated)."""
        from db.models import Signal

        repo, _ = mock_repo_with_snapshots

        # Calculate signals twice
        calculate_signals(repo.id, test_db)
        calculate_signals(repo.id, test_db)

        # Should still have only one signal per type
        db_signals = test_db.query(Signal).filter(Signal.repo_id == repo.id).all()
        signal_types = [s.signal_type for s in db_signals]
        assert len(signal_types) == len(set(signal_types))  # No duplicates
