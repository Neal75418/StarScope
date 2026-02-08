"""
異常偵測服務，用於識別早期訊號。
偵測 rising star、突然暴漲、breakout 及其他異常。
"""

import bisect
import logging
import threading
from datetime import timedelta
from typing import List, Optional, Dict, Any

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from db.models import (
    Repo, RepoSnapshot, Signal, SignalType,
    EarlySignal, EarlySignalType, EarlySignalSeverity,
    ContextSignal, ContextSignalType,
)
from services.queries import build_snapshot_map, build_signal_map
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

        Args:
            velocity_values: 預排序的 velocity 值列表，用於 O(log n) 百分位計算。
                             未提供時回退為 SQL COUNT 查詢。
        """
        repo_id = int(repo.id)

        # 取得最新快照（優先使用預載資料）
        snapshot = snapshot_map.get(repo_id) if snapshot_map else None
        if snapshot is None:
            snapshot = db.query(RepoSnapshot).filter(
                RepoSnapshot.repo_id == repo.id
            ).order_by(RepoSnapshot.snapshot_date.desc()).first()

        if not snapshot or snapshot.stars is None:
            return None

        stars = snapshot.stars

        # 僅處理門檻以下的 repo
        if stars >= RISING_STAR_MAX_STARS:
            return None

        # 取得 velocity 訊號（優先使用預載資料）
        velocity: Optional[float] = None
        if signal_map:
            repo_signals = signal_map.get(repo_id, {})
            velocity = repo_signals.get(SignalType.VELOCITY)

        if velocity is None:
            velocity_signal = db.query(Signal).filter(
                Signal.repo_id == repo.id,
                Signal.signal_type == SignalType.VELOCITY
            ).first()
            if not velocity_signal:
                return None
            velocity = velocity_signal.value

        # 檢查條件
        velocity_ratio = velocity / stars if stars > 0 else 0
        is_rising = velocity >= RISING_STAR_MIN_VELOCITY or velocity_ratio >= RISING_STAR_VELOCITY_RATIO

        if not is_rising:
            return None

        # 決定嚴重等級
        if velocity >= 50 or velocity_ratio >= 0.05:
            severity = EarlySignalSeverity.HIGH
        elif velocity >= 20 or velocity_ratio >= 0.02:
            severity = EarlySignalSeverity.MEDIUM
        else:
            severity = EarlySignalSeverity.LOW

        # 計算百分位數
        if velocity_values is not None:
            # O(log n) 使用預排序的列表
            total = len(velocity_values)
            below = bisect.bisect_left(velocity_values, velocity)
            percentile = (below / total * 100) if total > 0 else 0
        else:
            # 回退：SQL COUNT 查詢
            from sqlalchemy import func as sa_func
            total = db.query(sa_func.count(Signal.id)).filter(
                Signal.signal_type == SignalType.VELOCITY
            ).scalar() or 0
            below = db.query(sa_func.count(Signal.id)).filter(
                Signal.signal_type == SignalType.VELOCITY,
                Signal.value < velocity
            ).scalar() or 0
            percentile = (below / total * 100) if total > 0 else 0

        return EarlySignal(
            repo_id=repo.id,
            signal_type=EarlySignalType.RISING_STAR,
            severity=severity,
            description=f"Rising star: {stars:,} stars with {velocity:.1f} stars/day velocity",
            velocity_value=float(velocity),
            star_count=int(stars),
            percentile_rank=float(percentile),
            detected_at=utc_now(),
            expires_at=utc_now() + timedelta(days=7),  # Signal valid for 7 days
        )

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
        # 取得近期快照
        snapshots = db.query(RepoSnapshot).filter(
            RepoSnapshot.repo_id == repo.id
        ).order_by(RepoSnapshot.snapshot_date.desc()).limit(30).all()

        if len(snapshots) < 2:
            return None

        # 計算每日差值
        deltas = []
        for i in range(len(snapshots) - 1):
            delta = snapshots[i].stars - snapshots[i + 1].stars
            deltas.append(delta)

        if not deltas:
            return None

        latest_delta = deltas[0] if deltas else 0
        avg_delta = sum(deltas[1:]) / len(deltas[1:]) if len(deltas) > 1 else 0

        # 檢查暴漲條件
        is_spike = (
            latest_delta > avg_delta * SUDDEN_SPIKE_MULTIPLIER and
            latest_delta >= SUDDEN_SPIKE_MIN_ABSOLUTE
        )

        if not is_spike:
            return None

        # Determine severity
        if latest_delta >= 1000:
            severity = EarlySignalSeverity.HIGH
        elif latest_delta >= 500:
            severity = EarlySignalSeverity.MEDIUM
        else:
            severity = EarlySignalSeverity.LOW

        return EarlySignal(
            repo_id=repo.id,
            signal_type=EarlySignalType.SUDDEN_SPIKE,
            severity=severity,
            description=f"Sudden spike: +{latest_delta:,} stars today (vs avg {avg_delta:.0f}/day)",
            velocity_value=float(latest_delta),
            star_count=int(snapshots[0].stars) if snapshots[0].stars else None,
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
        repo_id = int(repo.id)

        # 取得每週 velocity 資料（優先使用預載資料）
        delta_7d_val: Optional[float] = None
        delta_30d_val: Optional[float] = None

        if signal_map:
            repo_signals = signal_map.get(repo_id, {})
            delta_7d_val = repo_signals.get(SignalType.STARS_DELTA_7D)
            delta_30d_val = repo_signals.get(SignalType.STARS_DELTA_30D)

        if delta_7d_val is None:
            delta_7d = db.query(Signal).filter(
                Signal.repo_id == repo.id,
                Signal.signal_type == SignalType.STARS_DELTA_7D
            ).first()
            delta_7d_val = delta_7d.value if delta_7d else None

        if delta_30d_val is None:
            delta_30d = db.query(Signal).filter(
                Signal.repo_id == repo.id,
                Signal.signal_type == SignalType.STARS_DELTA_30D
            ).first()
            delta_30d_val = delta_30d.value if delta_30d else None

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

        # 取得 star 數（優先使用預載資料）
        snapshot = snapshot_map.get(repo_id) if snapshot_map else None
        if snapshot is None:
            snapshot = db.query(RepoSnapshot).filter(
                RepoSnapshot.repo_id == repo.id
            ).order_by(RepoSnapshot.snapshot_date.desc()).first()

        # Determine severity
        if current_weekly_velocity >= 10:
            severity = EarlySignalSeverity.HIGH
        elif current_weekly_velocity >= 5:
            severity = EarlySignalSeverity.MEDIUM
        else:
            severity = EarlySignalSeverity.LOW

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
        cutoff = utc_now() - timedelta(hours=48)

        hn_signal = db.query(ContextSignal).filter(
            ContextSignal.repo_id == repo.id,
            ContextSignal.signal_type == ContextSignalType.HACKER_NEWS,
            ContextSignal.fetched_at >= cutoff,
            ContextSignal.score >= VIRAL_HN_MIN_SCORE
        ).order_by(ContextSignal.score.desc()).first()

        if not hn_signal:
            return None

        # Determine severity
        if hn_signal.score >= 500:
            severity = EarlySignalSeverity.HIGH
        elif hn_signal.score >= 200:
            severity = EarlySignalSeverity.MEDIUM
        else:
            severity = EarlySignalSeverity.LOW

        # Get star count（優先使用預載資料）
        repo_id = int(repo.id)
        snapshot = snapshot_map.get(repo_id) if snapshot_map else None
        if snapshot is None:
            snapshot = db.query(RepoSnapshot).filter(
                RepoSnapshot.repo_id == repo.id
            ).order_by(RepoSnapshot.snapshot_date.desc()).first()

        return EarlySignal(
            repo_id=repo.id,
            signal_type=EarlySignalType.VIRAL_HN,
            severity=severity,
            description=f"Viral on HN: \"{hn_signal.title[:50]}...\" ({hn_signal.score} points)",
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
    ) -> List["EarlySignal"]:
        """
        對單一 repo 執行所有偵測演算法。
        回傳偵測到的訊號列表（尚未儲存）。
        """
        signals: List["EarlySignal"] = []

        # rising_star 需要 velocity_values 做百分位計算
        try:
            signal = AnomalyDetector.detect_rising_star(
                repo, db,
                snapshot_map=snapshot_map,
                signal_map=signal_map,
                velocity_values=velocity_values,
            )
            if signal:
                existing = db.query(EarlySignal).filter(
                    EarlySignal.repo_id == repo.id,
                    EarlySignal.signal_type == signal.signal_type,
                    EarlySignal.expires_at > utc_now(),
                    EarlySignal.acknowledged == False
                ).first()
                if not existing:
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
                if signal:
                    existing = db.query(EarlySignal).filter(
                        EarlySignal.repo_id == repo.id,
                        EarlySignal.signal_type == signal.signal_type,
                        EarlySignal.expires_at > utc_now(),
                        EarlySignal.acknowledged == False
                    ).first()
                    if not existing:
                        signals.append(signal)
            except SQLAlchemyError as e:
                logger.error(f"[異常偵測] {repo.full_name} 偵測器錯誤: {e}", exc_info=True)

        return signals

    def run_detection(self, db: Session) -> Dict[str, Any]:
        """
        對所有 repo 執行異常偵測。
        回傳偵測到的訊號摘要。
        """
        repos = db.query(Repo).all()

        # 預載快照與訊號資料，避免 N+1 查詢
        repo_ids = [int(r.id) for r in repos]
        snapshot_map = build_snapshot_map(db, repo_ids)
        signal_map = build_signal_map(db, repo_ids)

        # 預載並排序所有 velocity 值，供 rising_star 百分位計算（1 次查詢取代 2N 次）
        velocity_values = sorted(
            v
            for v in (
                db.query(Signal.value)
                .filter(Signal.signal_type == SignalType.VELOCITY)
                .all()
            )
            for v in [v[0]]
        )

        total_signals = 0
        signals_by_type: Dict[str, int] = {}

        for repo in repos:
            try:
                signals = self.detect_all_for_repo(
                    repo, db,
                    snapshot_map=snapshot_map,
                    signal_map=signal_map,
                    velocity_values=velocity_values,
                )
                for signal in signals:
                    db.add(signal)
                    total_signals += 1
                    signals_by_type[signal.signal_type] = signals_by_type.get(signal.signal_type, 0) + 1
            except Exception as e:
                logger.error(f"[異常偵測] {repo.full_name} 訊號偵測失敗: {e}", exc_info=True)

        db.commit()

        logger.info(f"[異常偵測] 異常偵測完成: 偵測到 {total_signals} 個訊號")

        return {
            "repos_scanned": len(repos),
            "signals_detected": total_signals,
            "by_type": signals_by_type,
        }


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
