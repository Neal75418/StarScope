"""
Tests for services/anomaly_detector.py - Anomaly detection service.
"""

import pytest
from datetime import timedelta

from db.models import (
    RepoSnapshot,
    Signal,
    EarlySignal,
    ContextSignal,
)
from constants import (
    SignalType,
    EarlySignalType,
    EarlySignalSeverity,
    ContextSignalType,
)
from services.anomaly_detector import (
    AnomalyDetector,
    get_anomaly_detector,
    run_detection,
    RISING_STAR_MAX_STARS,
    RISING_STAR_MIN_VELOCITY,
    SUDDEN_SPIKE_MULTIPLIER,
    SUDDEN_SPIKE_MIN_ABSOLUTE,
)
from utils.time import utc_now, utc_today


class TestDetectRisingStar:
    """Tests for detect_rising_star method."""

    def test_returns_none_when_no_snapshot(self, test_db, mock_repo):
        """Test returns None when no snapshot exists."""
        # Remove any existing snapshots
        test_db.query(RepoSnapshot).filter(RepoSnapshot.repo_id == mock_repo.id).delete()
        test_db.commit()

        result = AnomalyDetector.detect_rising_star(mock_repo, test_db)
        assert result is None

    def test_returns_none_when_stars_too_high(self, test_db, mock_repo):
        """Test returns None when stars exceed threshold."""
        # Create snapshot with high stars
        snapshot = RepoSnapshot(
            repo_id=mock_repo.id,
            snapshot_date=utc_today(),
            stars=10000,  # Above RISING_STAR_MAX_STARS
        )
        test_db.add(snapshot)
        test_db.commit()

        result = AnomalyDetector.detect_rising_star(mock_repo, test_db)
        assert result is None

    def test_returns_none_without_velocity_signal(self, test_db, mock_repo):
        """Test returns None when no velocity signal exists."""
        snapshot = RepoSnapshot(
            repo_id=mock_repo.id,
            snapshot_date=utc_today(),
            stars=1000,
        )
        test_db.add(snapshot)
        test_db.commit()

        result = AnomalyDetector.detect_rising_star(mock_repo, test_db)
        assert result is None

    def test_detects_rising_star_by_velocity(self, test_db, mock_repo):
        """Test detects rising star with high velocity."""
        # Remove existing snapshots
        test_db.query(RepoSnapshot).filter(RepoSnapshot.repo_id == mock_repo.id).delete()
        test_db.query(Signal).filter(Signal.repo_id == mock_repo.id).delete()

        # Create snapshot
        snapshot = RepoSnapshot(
            repo_id=mock_repo.id,
            snapshot_date=utc_today(),
            stars=2000,
        )
        test_db.add(snapshot)

        # Create velocity signal above threshold
        signal = Signal(
            repo_id=mock_repo.id,
            signal_type=SignalType.VELOCITY,
            value=15.0,  # Above RISING_STAR_MIN_VELOCITY
            calculated_at=utc_now(),
        )
        test_db.add(signal)
        test_db.commit()

        result = AnomalyDetector.detect_rising_star(mock_repo, test_db)

        assert result is not None
        assert result.signal_type == EarlySignalType.RISING_STAR
        assert result.repo_id == mock_repo.id

    def test_high_severity_for_high_velocity(self, test_db, mock_repo):
        """Test assigns HIGH severity for very high velocity."""
        test_db.query(RepoSnapshot).filter(RepoSnapshot.repo_id == mock_repo.id).delete()
        test_db.query(Signal).filter(Signal.repo_id == mock_repo.id).delete()

        snapshot = RepoSnapshot(repo_id=mock_repo.id, snapshot_date=utc_today(), stars=1000)
        test_db.add(snapshot)

        signal = Signal(
            repo_id=mock_repo.id,
            signal_type=SignalType.VELOCITY,
            value=60.0,  # Very high
            calculated_at=utc_now(),
        )
        test_db.add(signal)
        test_db.commit()

        result = AnomalyDetector.detect_rising_star(mock_repo, test_db)

        assert result is not None
        assert result.severity == EarlySignalSeverity.HIGH


class TestDetectSuddenSpike:
    """Tests for detect_sudden_spike method."""

    def test_returns_none_with_insufficient_snapshots(self, test_db, mock_repo):
        """Test returns None with less than 2 snapshots."""
        test_db.query(RepoSnapshot).filter(RepoSnapshot.repo_id == mock_repo.id).delete()

        snapshot = RepoSnapshot(repo_id=mock_repo.id, snapshot_date=utc_today(), stars=1000)
        test_db.add(snapshot)
        test_db.commit()

        result = AnomalyDetector.detect_sudden_spike(mock_repo, test_db)
        assert result is None

    def test_detects_spike(self, test_db, mock_repo):
        """Test detects sudden spike pattern."""
        test_db.query(RepoSnapshot).filter(RepoSnapshot.repo_id == mock_repo.id).delete()

        # Create snapshots showing spike
        today = utc_today()
        snapshots = [
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=today, stars=2000),
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=today - timedelta(days=1), stars=1500),
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=today - timedelta(days=2), stars=1450),
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=today - timedelta(days=3), stars=1400),
        ]
        test_db.add_all(snapshots)
        test_db.commit()

        result = AnomalyDetector.detect_sudden_spike(mock_repo, test_db)

        assert result is not None
        assert result.signal_type == EarlySignalType.SUDDEN_SPIKE

    def test_returns_none_without_spike(self, test_db, mock_repo):
        """Test returns None without spike pattern."""
        test_db.query(RepoSnapshot).filter(RepoSnapshot.repo_id == mock_repo.id).delete()

        # Create snapshots with steady growth
        today = utc_today()
        snapshots = [
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=today, stars=1050),
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=today - timedelta(days=1), stars=1000),
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=today - timedelta(days=2), stars=950),
        ]
        test_db.add_all(snapshots)
        test_db.commit()

        result = AnomalyDetector.detect_sudden_spike(mock_repo, test_db)
        assert result is None


class TestDetectBreakout:
    """Tests for detect_breakout method."""

    def test_returns_none_without_signals(self, test_db, mock_repo):
        """Test returns None when no delta signals exist."""
        test_db.query(Signal).filter(Signal.repo_id == mock_repo.id).delete()
        test_db.commit()

        result = AnomalyDetector.detect_breakout(mock_repo, test_db)
        assert result is None

    def test_detects_breakout(self, test_db, mock_repo):
        """Test detects breakout pattern."""
        test_db.query(Signal).filter(Signal.repo_id == mock_repo.id).delete()

        # Create signals showing breakout
        signals = [
            Signal(
                repo_id=mock_repo.id,
                signal_type=SignalType.STARS_DELTA_7D,
                value=35,  # Current week: 35/7 = 5/day
                calculated_at=utc_now(),
            ),
            Signal(
                repo_id=mock_repo.id,
                signal_type=SignalType.STARS_DELTA_30D,
                value=30,  # Total 30d: (30-35)/23 = negative prev weeks
                calculated_at=utc_now(),
            ),
        ]
        test_db.add_all(signals)
        test_db.commit()

        result = AnomalyDetector.detect_breakout(mock_repo, test_db)

        assert result is not None
        assert result.signal_type == EarlySignalType.BREAKOUT


class TestDetectViralHN:
    """Tests for detect_viral_hn method."""

    def test_returns_none_without_hn_signals(self, test_db, mock_repo):
        """Test returns None when no HN signals exist."""
        result = AnomalyDetector.detect_viral_hn(mock_repo, test_db)
        assert result is None

    def test_detects_viral_hn(self, test_db, mock_repo):
        """Test detects viral HN signal."""
        # Create HN context signal
        hn_signal = ContextSignal(
            repo_id=mock_repo.id,
            signal_type=ContextSignalType.HACKER_NEWS,
            external_id="hn123",
            title="Amazing project on HN",
            url="https://news.ycombinator.com/item?id=123",
            score=200,
            fetched_at=utc_now(),
        )
        test_db.add(hn_signal)
        test_db.commit()

        result = AnomalyDetector.detect_viral_hn(mock_repo, test_db)

        assert result is not None
        assert result.signal_type == EarlySignalType.VIRAL_HN

    def test_ignores_old_hn_signals(self, test_db, mock_repo):
        """Test ignores HN signals older than 48 hours."""
        # Create old HN signal
        old_time = utc_now() - timedelta(hours=72)
        hn_signal = ContextSignal(
            repo_id=mock_repo.id,
            signal_type=ContextSignalType.HACKER_NEWS,
            external_id="hn_old",
            title="Old HN post",
            url="https://news.ycombinator.com/item?id=old",
            score=500,
            fetched_at=old_time,
        )
        test_db.add(hn_signal)
        test_db.commit()

        result = AnomalyDetector.detect_viral_hn(mock_repo, test_db)
        assert result is None


class TestDetectAllForRepo:
    """Tests for detect_all_for_repo method."""

    def test_returns_empty_list_when_no_signals(self, test_db, mock_repo):
        """Test returns empty list when no anomalies detected."""
        test_db.query(RepoSnapshot).filter(RepoSnapshot.repo_id == mock_repo.id).delete()
        test_db.query(Signal).filter(Signal.repo_id == mock_repo.id).delete()
        test_db.commit()

        result = AnomalyDetector.detect_all_for_repo(mock_repo, test_db)
        assert result == []

    def test_skips_duplicate_signals(self, test_db, mock_repo):
        """Test skips signals that already exist and haven't expired."""
        # Create existing signal
        existing = EarlySignal(
            repo_id=mock_repo.id,
            signal_type=EarlySignalType.RISING_STAR,
            severity=EarlySignalSeverity.LOW,
            description="Existing",
            detected_at=utc_now(),
            expires_at=utc_now() + timedelta(days=7),
            acknowledged=False,
        )
        test_db.add(existing)
        test_db.commit()

        # Setup conditions for rising star detection
        test_db.query(RepoSnapshot).filter(RepoSnapshot.repo_id == mock_repo.id).delete()
        test_db.query(Signal).filter(Signal.repo_id == mock_repo.id).delete()

        snapshot = RepoSnapshot(repo_id=mock_repo.id, snapshot_date=utc_today(), stars=1000)
        signal = Signal(
            repo_id=mock_repo.id,
            signal_type=SignalType.VELOCITY,
            value=20.0,
            calculated_at=utc_now(),
        )
        test_db.add_all([snapshot, signal])
        test_db.commit()

        result = AnomalyDetector.detect_all_for_repo(mock_repo, test_db)

        # Should not include rising star since it already exists
        rising_stars = [s for s in result if s.signal_type == EarlySignalType.RISING_STAR]
        assert len(rising_stars) == 0


class TestRunDetection:
    """Tests for run_detection method and convenience function."""

    def test_scans_all_repos(self, test_db, mock_multiple_repos):
        """Test scans all repos in database."""
        detector = AnomalyDetector()
        result = detector.run_detection(test_db)

        assert result["repos_scanned"] == 3
        assert "signals_detected" in result
        assert "by_type" in result

    def test_convenience_function(self, test_db, mock_repo):
        """Test run_detection convenience function."""
        result = run_detection(test_db)

        assert "repos_scanned" in result
        assert "signals_detected" in result


class TestGetAnomalyDetector:
    """Tests for get_anomaly_detector function."""

    @pytest.fixture(autouse=True)
    def reset_singleton(self):
        import services.anomaly_detector as detector_module
        original = detector_module._detector
        detector_module._detector = None
        yield
        detector_module._detector = original

    def test_returns_singleton(self):
        """Test returns the same instance."""
        d1 = get_anomaly_detector()
        d2 = get_anomaly_detector()

        assert d1 is d2



class TestConstants:
    """Tests for module constants — 驗證行為不變式而非具體值。"""

    def test_rising_star_thresholds_are_reasonable(self):
        """Test rising star thresholds maintain logical invariants."""
        assert RISING_STAR_MIN_VELOCITY > 0  # velocity threshold must be positive
        assert RISING_STAR_MAX_STARS > 0  # star count ceiling must be positive

    def test_spike_thresholds_are_reasonable(self):
        """Test spike thresholds maintain logical invariants."""
        assert SUDDEN_SPIKE_MULTIPLIER > 1  # must be a multiplier above 1x
        assert SUDDEN_SPIKE_MIN_ABSOLUTE > 0  # must require positive absolute growth
