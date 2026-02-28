"""
異常偵測服務，用於識別早期訊號。
偵測 rising star、突然暴漲、breakout 及其他異常。
"""

import bisect
import logging
import threading
from datetime import timedelta
from typing import List, Optional, Dict, Any, Set, Tuple

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from constants import SignalType, EarlySignalType, EarlySignalSeverity, ContextSignalType
from db.models import (
    Repo, RepoSnapshot, Signal,
    EarlySignal, ContextSignal,
)
from services.queries import (
    build_snapshot_map, build_signal_map,
    get_snapshot_for_repo, get_signal_value,
)
from utils.time import utc_now

logger = logging.getLogger(__name__)

# 偵測門檻
RISING_STAR_MAX_STARS = 5000  # Max stars to be considered "rising"
RISING_STAR_MIN_VELOCITY = 10  # Min velocity to be notable
RISING_STAR_VELOCITY_RATIO = 0.01  # velocity/stars ratio threshold

SUDDEN_SPIKE_MULTIPLIER = 3  # Daily growth must be 3x average
SUDDEN_SPIKE_MIN_ABSOLUTE = 100  # Minimum absolute growth

BREAKOUT_VELOCITY_THRESHOLD = 2  # Current week velocity must be > 2

VIRAL_HN_MIN_SCORE = 100  # Minimum HN score to trigger

# 嚴重度門檻（各偵測器）
RISING_STAR_SEVERITY_HIGH = 50
RISING_STAR_SEVERITY_MEDIUM = 20
SUDDEN_SPIKE_SEVERITY_HIGH = 1000
SUDDEN_SPIKE_SEVERITY_MEDIUM = 500
BREAKOUT_SEVERITY_HIGH = 10
BREAKOUT_SEVERITY_MEDIUM = 5
VIRAL_HN_SEVERITY_HIGH = 500
VIRAL_HN_SEVERITY_MEDIUM = 200


def _determine_severity(
    value: float,
    high_threshold: float,
    medium_threshold: float,
) -> str:
    """根據值與門檻判斷嚴重等級。"""
    if value >= high_threshold:
        return EarlySignalSeverity.HIGH
    if value >= medium_threshold:
        return EarlySignalSeverity.MEDIUM
    return EarlySignalSeverity.LOW


def _signal_already_active(repo_id: int, signal_type: str, db: Session) -> bool:
    """檢查是否已存在未過期、未確認的同類型 signal（單次查詢 fallback）。"""
    return db.query(EarlySignal).filter(
        EarlySignal.repo_id == repo_id,
        EarlySignal.signal_type == signal_type,
        EarlySignal.expires_at > utc_now(),
        EarlySignal.acknowledged == False  # noqa: E712
    ).first() is not None


def _build_active_signals_set(db: Session) -> Set[Tuple[int, str]]:
    """一次性預載所有 active early signals，回傳 {(repo_id, signal_type)} set。"""
    rows = db.query(
        EarlySignal.repo_id, EarlySignal.signal_type
    ).filter(
        EarlySignal.expires_at > utc_now(),
        EarlySignal.acknowledged == False  # noqa: E712
    ).all()
    return {(int(row[0]), row[1]) for row in rows}


def _determine_rising_star_severity(velocity: float, velocity_ratio: float) -> str:
    """根據 velocity 與 velocity/stars 比例判斷 rising star 嚴重等級。"""
    if velocity >= RISING_STAR_SEVERITY_HIGH or velocity_ratio >= 0.05:
        return EarlySignalSeverity.HIGH
    if velocity >= RISING_STAR_SEVERITY_MEDIUM or velocity_ratio >= 0.02:
        return EarlySignalSeverity.MEDIUM
    return EarlySignalSeverity.LOW


def _calculate_velocity_percentile(
    velocity: float,
    velocity_values: Optional[List[float]],
    db: Session,
) -> float:
    """計算 velocity 的百分位排名。"""
    if velocity_values is not None:
        total = len(velocity_values)
        below = bisect.bisect_left(velocity_values, velocity)
    else:
        from sqlalchemy import func as sa_func
        total = db.query(sa_func.count(Signal.id)).filter(
            Signal.signal_type == SignalType.VELOCITY
        ).scalar() or 0
        below = db.query(sa_func.count(Signal.id)).filter(
            Signal.signal_type == SignalType.VELOCITY,
            Signal.value < velocity
        ).scalar() or 0
    return (below / total * 100) if total > 0 else 0


class AnomalyDetector:
    """偵測早期訊號與異常的服務。"""

    @staticmethod
    def detect_rising_star(
        repo: "Repo",
        db: Session,
        snapshot_map: Optional[Dict[int, "RepoSnapshot"]] = None,
        signal_map: Optional[Dict[int, Dict[str, float]]] = None,
        velocity_values: Optional[List[float]] = None,
    ) -> Optional["EarlySignal"]:
        """
        偵測 rising star 模式。
        條件：stars < 5000 且（velocity > 10 或 velocity/stars > 0.01）
        """
        # noinspection PyTypeChecker
        repo_id: int = repo.id  # type: ignore[assignment]

        snapshot = get_snapshot_for_repo(repo_id, db, snapshot_map)
        if not snapshot or snapshot.stars is None:
            return None

        stars = snapshot.stars

        # 僅處理門檻以下的 repo
        if stars >= RISING_STAR_MAX_STARS:
            return None

        velocity = get_signal_value(repo_id, SignalType.VELOCITY, db, signal_map)
        if velocity is None:
            return None

        # 檢查條件
        velocity_ratio = velocity / stars if stars > 0 else 0
        is_rising = velocity >= RISING_STAR_MIN_VELOCITY or velocity_ratio >= RISING_STAR_VELOCITY_RATIO

        if not is_rising:
            return None

        severity = _determine_rising_star_severity(velocity, velocity_ratio)
        percentile = _calculate_velocity_percentile(velocity, velocity_values, db)

        return EarlySignal(
            repo_id=repo.id,
            signal_type=EarlySignalType.RISING_STAR,
            severity=severity,
            description=f"Rising star: {stars:,} stars with {velocity:.1f} stars/day velocity",
            velocity_value=float(velocity),
            # noinspection PyTypeChecker
            star_count=int(stars),
            percentile_rank=float(percentile),
            detected_at=utc_now(),
            expires_at=utc_now() + timedelta(days=7),
        )

    @staticmethod
    def _calculate_star_deltas(snapshots: List["RepoSnapshot"]) -> Tuple[int, float]:
        """
        計算每日 star 差值。
        回傳 (latest_delta, avg_delta)。
        """
        deltas = []
        for i in range(len(snapshots) - 1):
            delta = snapshots[i].stars - snapshots[i + 1].stars
            deltas.append(delta)

        if not deltas:
            return 0, 0.0

        latest_delta = deltas[0]
        avg_delta = sum(deltas[1:]) / len(deltas[1:]) if len(deltas) > 1 else 0.0
        return latest_delta, avg_delta

    @staticmethod
    def detect_sudden_spike(
        repo: "Repo",
        db: Session,
        snapshot_map: Optional[Dict[int, "RepoSnapshot"]] = None,
        signal_map: Optional[Dict[int, Dict[str, float]]] = None,
    ) -> Optional["EarlySignal"]:
        """
        偵測突然暴漲模式。
        條件：today_delta > 3 倍 avg_daily 且絕對值 > 100
        """
        _ = snapshot_map  # 由呼叫端傳入，本偵測器直接查詢快照
        _ = signal_map  # 由呼叫端傳入，本偵測器不使用訊號

        # 取得近期快照
        snapshots = db.query(RepoSnapshot).filter(
            RepoSnapshot.repo_id == repo.id
        ).order_by(RepoSnapshot.snapshot_date.desc()).limit(30).all()

        if len(snapshots) < 2:
            return None

        # 計算每日差值
        latest_delta, avg_delta = AnomalyDetector._calculate_star_deltas(snapshots)

        if latest_delta == 0:
            return None

        # 檢查暴漲條件
        is_spike = (
            latest_delta > avg_delta * SUDDEN_SPIKE_MULTIPLIER and
            latest_delta >= SUDDEN_SPIKE_MIN_ABSOLUTE
        )

        if not is_spike:
            return None

        severity = _determine_severity(
            latest_delta, SUDDEN_SPIKE_SEVERITY_HIGH, SUDDEN_SPIKE_SEVERITY_MEDIUM
        )

        # noinspection PyTypeChecker
        latest_stars: int = snapshots[0].stars

        return EarlySignal(
            repo_id=repo.id,
            signal_type=EarlySignalType.SUDDEN_SPIKE,
            severity=severity,
            description=f"Sudden spike: +{latest_delta:,} stars today (vs avg {avg_delta:.0f}/day)",
            velocity_value=float(latest_delta),
            star_count=latest_stars if latest_stars else None,
            detected_at=utc_now(),
            expires_at=utc_now() + timedelta(days=3),  # Short-lived signal
        )

    @staticmethod
    def detect_breakout(
        repo: "Repo",
        db: Session,
        snapshot_map: Optional[Dict[int, "RepoSnapshot"]] = None,
        signal_map: Optional[Dict[int, Dict[str, float]]] = None,
    ) -> Optional["EarlySignal"]:
        """
        偵測 breakout 模式。
        條件：上週 velocity <= 0 且本週 velocity > 2
        """
        # noinspection PyTypeChecker
        repo_id: int = repo.id  # type: ignore[assignment]

        delta_7d_val = get_signal_value(repo_id, SignalType.STARS_DELTA_7D, db, signal_map)
        delta_30d_val = get_signal_value(repo_id, SignalType.STARS_DELTA_30D, db, signal_map)

        if delta_7d_val is None or delta_30d_val is None:
            return None

        current_weekly_velocity = delta_7d_val / 7 if delta_7d_val else 0

        # 從 30 天 delta 估算上週 velocity
        prev_weeks_velocity = (delta_30d_val - delta_7d_val) / 23 if delta_30d_val else 0

        # 檢查 breakout 條件
        is_breakout = (
            prev_weeks_velocity <= 0 and
            current_weekly_velocity >= BREAKOUT_VELOCITY_THRESHOLD
        )

        if not is_breakout:
            return None

        snapshot = get_snapshot_for_repo(repo_id, db, snapshot_map)

        severity = _determine_severity(
            current_weekly_velocity, BREAKOUT_SEVERITY_HIGH, BREAKOUT_SEVERITY_MEDIUM
        )

        return EarlySignal(
            repo_id=repo.id,
            signal_type=EarlySignalType.BREAKOUT,
            severity=severity,
            description=f"Breakout: velocity went from {prev_weeks_velocity:.1f} to {current_weekly_velocity:.1f} stars/day",
            velocity_value=float(current_weekly_velocity),
            star_count=int(snapshot.stars) if snapshot and snapshot.stars else None,
            detected_at=utc_now(),
            expires_at=utc_now() + timedelta(days=7),
        )

    @staticmethod
    def detect_viral_hn(
        repo: "Repo",
        db: Session,
        snapshot_map: Optional[Dict[int, "RepoSnapshot"]] = None,
        signal_map: Optional[Dict[int, Dict[str, float]]] = None,
    ) -> Optional["EarlySignal"]:
        """
        偵測 Hacker News 爆紅訊號。
        條件：48 小時內 HN 貼文分數 >= 100
        """
        _ = signal_map  # 由呼叫端傳入，本偵測器不使用訊號
        cutoff = utc_now() - timedelta(hours=48)

        hn_signal = db.query(ContextSignal).filter(
            ContextSignal.repo_id == repo.id,
            ContextSignal.signal_type == ContextSignalType.HACKER_NEWS,
            ContextSignal.fetched_at >= cutoff,
            ContextSignal.score >= VIRAL_HN_MIN_SCORE
        ).order_by(ContextSignal.score.desc()).first()

        if not hn_signal:
            return None

        # noinspection PyTypeChecker
        severity = _determine_severity(
            hn_signal.score, VIRAL_HN_SEVERITY_HIGH, VIRAL_HN_SEVERITY_MEDIUM
        )

        # noinspection PyTypeChecker
        repo_id: int = repo.id  # type: ignore[assignment]
        snapshot = get_snapshot_for_repo(repo_id, db, snapshot_map)

        return EarlySignal(
            repo_id=repo.id,
            signal_type=EarlySignalType.VIRAL_HN,
            severity=severity,
            description=f"Viral on HN: \"{hn_signal.title[:50]}...\" ({hn_signal.score} points)",
            # noinspection PyTypeChecker
            star_count=int(snapshot.stars) if snapshot and snapshot.stars else None,
            detected_at=utc_now(),
            expires_at=utc_now() + timedelta(days=3),
        )

    @staticmethod
    def detect_all_for_repo(
        repo: "Repo",
        db: Session,
        snapshot_map: Optional[Dict[int, "RepoSnapshot"]] = None,
        signal_map: Optional[Dict[int, Dict[str, float]]] = None,
        velocity_values: Optional[List[float]] = None,
        active_signals: Optional[Set[Tuple[int, str]]] = None,
    ) -> List["EarlySignal"]:
        """
        對單一 repo 執行所有偵測演算法。
        回傳偵測到的訊號列表（尚未儲存）。

        Args:
            active_signals: 預載的 active signals set，避免 N+1 查詢。
                            若為 None 則 fallback 至逐次 DB 查詢。
        """
        signals: List["EarlySignal"] = []
        repo_id = int(repo.id)

        def _is_active(sig_type: str) -> bool:
            if active_signals is not None:
                return (repo_id, sig_type) in active_signals
            return _signal_already_active(repo_id, sig_type, db)

        # rising_star 需要 velocity_values 做百分位計算
        try:
            signal = AnomalyDetector.detect_rising_star(
                repo, db,
                snapshot_map=snapshot_map,
                signal_map=signal_map,
                velocity_values=velocity_values,
            )
            if signal and not _is_active(signal.signal_type):
                signals.append(signal)
        except SQLAlchemyError as e:
            logger.error(f"[異常偵測] {repo.full_name} rising_star 錯誤: {e}", exc_info=True)

        # 其餘偵測器不需要 velocity_values
        other_detectors = [
            AnomalyDetector.detect_sudden_spike,
            AnomalyDetector.detect_breakout,
            AnomalyDetector.detect_viral_hn,
        ]

        for detector in other_detectors:
            try:
                signal = detector(repo, db, snapshot_map=snapshot_map, signal_map=signal_map)
                if signal and not _is_active(signal.signal_type):
                    signals.append(signal)
            except SQLAlchemyError as e:
                logger.error(f"[異常偵測] {repo.full_name} 偵測器錯誤: {e}", exc_info=True)

        return signals

    def run_detection(self, db: Session) -> Dict[str, Any]:
        """
        對所有 repo 執行異常偵測並儲存結果。
        回傳偵測到的訊號摘要。
        """
        all_signals = self.detect_all(db)
        saved = save_detected_signals(all_signals, db)

        signals_by_type: Dict[str, int] = {}
        for s in all_signals:
            signals_by_type[s.signal_type] = signals_by_type.get(s.signal_type, 0) + 1

        logger.info(f"[異常偵測] 異常偵測完成: 偵測到 {saved} 個訊號")

        repos_count = db.query(Repo).count()
        return {
            "repos_scanned": repos_count,
            "signals_detected": saved,
            "by_type": signals_by_type,
        }

    def detect_all(self, db: Session) -> List["EarlySignal"]:
        """
        對所有 repo 執行異常偵測，回傳偵測到的訊號列表。
        不寫入 DB。
        """
        # noinspection PyTypeChecker
        repos: List[Repo] = db.query(Repo).all()

        # 預載快照與訊號資料，避免 N+1 查詢
        # noinspection PyTypeChecker
        repo_ids: List[int] = [r.id for r in repos]
        snapshot_map = build_snapshot_map(db, repo_ids)
        signal_map = build_signal_map(db, repo_ids)

        # 預載並排序所有 velocity 值，供 rising_star 百分位計算（1 次查詢取代 2N 次）
        rows = db.query(Signal.value).filter(
            Signal.signal_type == SignalType.VELOCITY
        ).all()
        # noinspection PyTypeChecker
        velocity_values: List[float] = sorted(row[0] for row in rows)

        # 預載所有 active early signals，避免 detect_all_for_repo 中的 N+1 查詢
        active_signals = _build_active_signals_set(db)

        all_signals: List["EarlySignal"] = []

        for repo in repos:
            try:
                signals = self.detect_all_for_repo(
                    repo, db,
                    snapshot_map=snapshot_map,
                    signal_map=signal_map,
                    velocity_values=velocity_values,
                    active_signals=active_signals,
                )
                all_signals.extend(signals)
            except Exception as e:
                logger.error(f"[異常偵測] {repo.full_name} 訊號偵測失敗: {e}", exc_info=True)

        return all_signals


def save_detected_signals(signals: List["EarlySignal"], db: Session) -> int:
    """將偵測到的 signals 寫入 DB。"""
    for s in signals:
        db.add(s)
    db.commit()
    return len(signals)


# 模組層級 singleton
_detector: Optional[AnomalyDetector] = None
_detector_lock = threading.Lock()


def get_anomaly_detector() -> AnomalyDetector:
    """取得預設的異常偵測器實例。"""
    global _detector
    if _detector is None:
        with _detector_lock:
            if _detector is None:
                _detector = AnomalyDetector()
                logger.info("[異常偵測] 異常偵測器已初始化")
    return _detector


def run_detection(db: Session) -> Dict[str, Any]:
    """執行偵測的便利函式。"""
    detector = get_anomaly_detector()
    return detector.run_detection(db)
