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
        """Fewer than 3 snapshots → None（2 筆只有 1 個 delta，無法與歷史平均比較）。"""
        test_db.query(RepoSnapshot).filter(RepoSnapshot.repo_id == mock_repo.id).delete()

        snapshot = RepoSnapshot(repo_id=mock_repo.id, snapshot_date=utc_today(), stars=1000)
        test_db.add(snapshot)
        test_db.commit()

        result = AnomalyDetector.detect_sudden_spike(mock_repo, test_db)
        assert result is None

    def test_returns_none_with_exactly_two_snapshots(self, test_db, mock_repo):
        """邊界：恰好 2 筆快照仍不足（門檻是 ≥3）。"""
        from datetime import timedelta

        test_db.query(RepoSnapshot).filter(RepoSnapshot.repo_id == mock_repo.id).delete()
        test_db.add_all([
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=utc_today() - timedelta(days=1), stars=1000),
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=utc_today(), stars=2000),
        ])
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


class TestDetectAllBatchPath:
    """生產路徑（detect_all 批次預載）必須與逐 repo fallback 路徑得到相同結果。

    背景：所有偵測器都有「預載 map」與「逐筆查 DB」雙實作，先前測試只走 fallback，
    批次路徑（生產每 30 分鐘實際在跑的那條）處於覆蓋假象。
    """

    @pytest.fixture
    def spiking_repo(self, test_db, mock_repo):
        """給 mock_repo 灌出一個 sudden spike + viral HN 的資料形狀。"""
        test_db.query(RepoSnapshot).filter(RepoSnapshot.repo_id == mock_repo.id).delete()

        today = utc_today()
        stars = 1000
        # 10 天平緩成長（每日 +10），最後一天暴增 +500（> 平均 3 倍且 >= 100）
        for i in range(10, 0, -1):
            stars += 500 if i == 1 else 10
            test_db.add(RepoSnapshot(
                repo_id=mock_repo.id,
                snapshot_date=today - timedelta(days=i - 1),
                fetched_at=utc_now() - timedelta(days=i - 1),
                stars=stars, forks=10, watchers=5, open_issues=1,
            ))

        # 兩筆 HN 訊號：批次 map 取最高分（150），fallback 查詢 order_by score desc 同義
        for ext_id, score in [("hn-1", 120), ("hn-2", 150)]:
            test_db.add(ContextSignal(
                repo_id=mock_repo.id,
                signal_type=ContextSignalType.HACKER_NEWS,
                external_id=ext_id,
                title=f"Post {ext_id}",
                url="https://news.ycombinator.com/item",
                score=score,
                fetched_at=utc_now(),
            ))
        test_db.commit()
        return mock_repo

    def test_batch_path_matches_fallback_path(self, test_db, spiking_repo):
        """同一份資料，批次路徑與 fallback 路徑的偵測結果必須一致且非空。"""
        detector = AnomalyDetector()

        batch_signals = detector.detect_all(test_db)
        batch_types = {(s.repo_id, s.signal_type) for s in batch_signals}

        fallback_signals = detector.detect_all_for_repo(spiking_repo, test_db)
        fallback_types = {(s.repo_id, s.signal_type) for s in fallback_signals}

        # 有實際偵測到東西（測試有牙齒），且兩條路徑一致
        assert (spiking_repo.id, EarlySignalType.SUDDEN_SPIKE) in batch_types
        assert (spiking_repo.id, EarlySignalType.VIRAL_HN) in batch_types
        assert batch_types == fallback_types

    def test_batch_viral_hn_uses_highest_score(self, test_db, spiking_repo):
        """批次 hn_signal_map 對同 repo 多筆 HN 訊號必須取最高分（150 非 120）。"""
        detector = AnomalyDetector()
        batch_signals = detector.detect_all(test_db)

        viral = [s for s in batch_signals
                 if s.repo_id == spiking_repo.id and s.signal_type == EarlySignalType.VIRAL_HN]
        assert len(viral) == 1
        assert "(150 points)" in viral[0].description


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
