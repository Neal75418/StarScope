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
            # published_at 是判斷依據；fetched_at 只是「我們什麼時候抓的」，
            # 排程每隔幾小時就刷新它，拿它當時間窗口會恆真
            published_at=utc_now(),
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
            # 關鍵：發文很舊，但「剛剛才抓到」——正是排程刷新後的真實狀態。
            # 若判斷依據錯用 fetched_at，這個貼文就會被誤判成「48 小時內爆紅」
            published_at=old_time,
            fetched_at=utc_now(),
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
                published_at=utc_now(),
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


class TestViralHnUsesPublishTimeNotFetchTime:
    """
    「48 小時內上 HN」要看發文時間，不是 StarScope 的抓取時間。

    原本篩 ContextSignal.fetched_at，而抓取排程每隔幾小時就刷新它一次，
    所以那個條件恆真。2026-08-23 實測：用 fetched_at 篩出 348 筆（含 2021 年的
    uBlock Origin 與 TensorFlow 舊聞），用 published_at 篩出 0 筆。

    這是同一個 session 內第二次遇到的同款缺陷——weekly_summary 的 HN 區塊
    先前也是篩 fetched_at。
    """

    def _repo_with_hn(self, test_db, published_days_ago: int, score: int = 500):
        from db.models import Repo, ContextSignal, RepoSnapshot
        from constants import ContextSignalType
        from utils.time import utc_now
        from datetime import timedelta, date

        repo = Repo(owner="a", name=f"r{published_days_ago}",
                    full_name=f"a/r{published_days_ago}",
                    url="https://github.com/a/r", added_at=utc_now(), updated_at=utc_now())
        test_db.add(repo)
        test_db.flush()
        test_db.add(RepoSnapshot(repo_id=repo.id, stars=10_000, forks=1, open_issues=1,
                                 snapshot_date=date(2026, 8, 23), fetched_at=utc_now()))
        test_db.add(ContextSignal(
            repo_id=repo.id, signal_type=ContextSignalType.HACKER_NEWS,
            external_id=f"hn{published_days_ago}", title="Some post",
            url="https://news.ycombinator.com/item?id=1", score=score,
            # 關鍵：發文很久以前，但「剛剛才抓到」——正是排程刷新後的真實狀態
            published_at=utc_now() - timedelta(days=published_days_ago),
            fetched_at=utc_now(),
        ))
        test_db.commit()
        return repo

    def test_old_post_fetched_just_now_does_not_fire(self, test_db):
        from services.anomaly_detector import AnomalyDetector

        repo = self._repo_with_hn(test_db, published_days_ago=1000)

        assert AnomalyDetector.detect_viral_hn(repo, test_db) is None, (
            "五年前的 HN 貼文因為剛被重新抓取就觸發了——篩的是 fetched_at 而不是 published_at"
        )

    def test_recent_post_fires(self, test_db):
        from services.anomaly_detector import AnomalyDetector

        repo = self._repo_with_hn(test_db, published_days_ago=1)

        signal = AnomalyDetector.detect_viral_hn(repo, test_db)
        assert signal is not None, "24 小時前發布、500 分的貼文應該觸發"

    def test_batch_path_agrees_with_single_path(self, test_db):
        """
        detect_all 的批次預載與 detect_viral_hn 的單筆查詢用的是兩份分開寫的條件。
        不同步的話結果會不一樣，而且不會有任何錯誤浮出來。
        """
        from services.anomaly_detector import AnomalyDetector

        old = self._repo_with_hn(test_db, published_days_ago=1000)
        recent = self._repo_with_hn(test_db, published_days_ago=1)

        batch = {s.repo_id for s in AnomalyDetector().detect_all(test_db)
                 if s.signal_type == "viral_hn"}
        single = {r.id for r in (old, recent)
                  if AnomalyDetector.detect_viral_hn(r, test_db) is not None}

        assert batch == single, f"批次 {batch} 與單筆 {single} 不一致"


class TestSeverityAndPercentileAreNotJustPlausibleNumbers:
    """三個「壞掉會安靜」的計算：嚴重度分級、百分位、velocity 比率。

    掃描時這三個各自的突變（high/medium 門檻對調、百分位算成 100-x、
    比率的分子分母顛倒）全部通過 750 個測試——它們都只是把一個合理的
    數字換成另一個合理的數字，畫面上看不出異常。
    """

    def test_severity_bands_are_not_interchangeable(self):
        from services.anomaly_detector import _determine_severity
        from constants import EarlySignalSeverity

        # 邊界值取在門檻上：>= 而非 > 這件事本身也要釘住
        assert _determine_severity(100.0, 100.0, 50.0) == EarlySignalSeverity.HIGH
        assert _determine_severity(99.9, 100.0, 50.0) == EarlySignalSeverity.MEDIUM
        assert _determine_severity(50.0, 100.0, 50.0) == EarlySignalSeverity.MEDIUM
        assert _determine_severity(49.9, 100.0, 50.0) == EarlySignalSeverity.LOW

    def test_percentile_counts_those_below_not_above(self, test_db):
        """百分位是「贏過多少比例」。算成 100-x 的話，最慢的會顯示為最快。"""
        from services.anomaly_detector import _calculate_velocity_percentile

        values = [1.0, 2.0, 3.0, 4.0]  # 已排序，走 bisect 那條路
        # 3.0 贏過 1.0 與 2.0 兩筆 ⇒ 2/4 = 50%
        assert _calculate_velocity_percentile(3.0, values, test_db) == pytest.approx(50.0)
        # 最低的一筆贏過 0 筆，不是贏過全部
        assert _calculate_velocity_percentile(1.0, values, test_db) == pytest.approx(0.0)
        assert _calculate_velocity_percentile(5.0, values, test_db) == pytest.approx(100.0)

    def test_ratio_path_fires_for_a_small_repo_the_absolute_threshold_would_miss(self, test_db):
        """velocity/stars 這條路存在的理由：小專案的絕對速度永遠達不到門檻。

        分子分母顛倒的話這條路等於失效，rising star 就退化成「只看絕對速度」，
        而那正是這個產品刻意要避免的偏誤。
        """
        from db.models import Repo, RepoSnapshot, Signal
        from services.anomaly_detector import AnomalyDetector
        from constants import SignalType
        from utils.time import utc_now, utc_today

        repo = Repo(owner="tiny", name="rocket", full_name="tiny/rocket",
                    url="https://github.com/tiny/rocket", github_id=90001)
        test_db.add(repo)
        test_db.commit()

        # 200 顆星、每天 +5：絕對速度 5 < 10（達不到門檻），
        # 但比率 5/200 = 0.025 > 0.01 ⇒ 應該要被抓出來
        test_db.add(RepoSnapshot(repo_id=repo.id, stars=200, forks=0, watchers=0,
                                 open_issues=0, snapshot_date=utc_today(),
                                 fetched_at=utc_now()))
        test_db.add(Signal(repo_id=repo.id, signal_type=SignalType.VELOCITY,
                           value=5.0, calculated_at=utc_now()))
        test_db.commit()

        signal = AnomalyDetector.detect_rising_star(repo, test_db)
        assert signal is not None, "小專案靠比率這條路應該要觸發"
        assert signal.star_count == 200

    def test_ratio_does_not_fire_for_a_bigger_repo_at_the_same_absolute_speed(self, test_db):
        """同樣每天 +5，4000 顆星的專案不該被當成 rising star。

        這條是上一條的鑑別對照：只有「該觸發」那一條的話，分子分母顛倒
        （stars/velocity = 800）一樣會觸發，測試照樣綠。要同時有一條
        「不該觸發」的案例，顛倒才會被抓出來——800 遠大於 0.01。
        """
        from db.models import Repo, RepoSnapshot, Signal
        from services.anomaly_detector import AnomalyDetector
        from constants import SignalType
        from utils.time import utc_now, utc_today

        repo = Repo(owner="mid", name="steady", full_name="mid/steady",
                    url="https://github.com/mid/steady", github_id=90002)
        test_db.add(repo)
        test_db.commit()

        # 4000 星、每天 +5：絕對速度 5 < 10，比率 5/4000 = 0.00125 < 0.01 ⇒ 兩條都不過
        test_db.add(RepoSnapshot(repo_id=repo.id, stars=4000, forks=0, watchers=0,
                                 open_issues=0, snapshot_date=utc_today(),
                                 fetched_at=utc_now()))
        test_db.add(Signal(repo_id=repo.id, signal_type=SignalType.VELOCITY,
                           value=5.0, calculated_at=utc_now()))
        test_db.commit()

        assert AnomalyDetector.detect_rising_star(repo, test_db) is None
