"""
Anomaly detection service for identifying early signals.
Detects rising stars, sudden spikes, breakouts, and other anomalies.
"""

import logging
from datetime import timedelta
from typing import List, Optional, Dict, Any

from sqlalchemy.orm import Session

from db.models import (
    Repo, RepoSnapshot, Signal, SignalType,
    EarlySignal, EarlySignalType, EarlySignalSeverity,
    ContextSignal, ContextSignalType,
)
from utils.time import utc_now

logger = logging.getLogger(__name__)

# Detection thresholds
RISING_STAR_MAX_STARS = 5000  # Max stars to be considered "rising"
RISING_STAR_MIN_VELOCITY = 10  # Min velocity to be notable
RISING_STAR_VELOCITY_RATIO = 0.01  # velocity/stars ratio threshold

SUDDEN_SPIKE_MULTIPLIER = 3  # Daily growth must be 3x average
SUDDEN_SPIKE_MIN_ABSOLUTE = 100  # Minimum absolute growth

BREAKOUT_VELOCITY_THRESHOLD = 2  # Current week velocity must be > 2

VIRAL_HN_MIN_SCORE = 100  # Minimum HN score to trigger


class AnomalyDetector:
    """Service for detecting early signals and anomalies."""

    @staticmethod
    def detect_rising_star(repo: "Repo", db: Session) -> Optional["EarlySignal"]:
        """
        Detect rising star pattern.
        Criteria: stars < 5000 AND (velocity > 10 OR velocity/stars > 0.01)
        """
        # Get latest snapshot
        snapshot = db.query(RepoSnapshot).filter(
            RepoSnapshot.repo_id == repo.id
        ).order_by(RepoSnapshot.snapshot_date.desc()).first()

        if not snapshot or snapshot.stars is None:
            return None

        stars = snapshot.stars

        # Only for repos under threshold
        if stars >= RISING_STAR_MAX_STARS:
            return None

        # Get velocity signal
        velocity_signal = db.query(Signal).filter(
            Signal.repo_id == repo.id,
            Signal.signal_type == SignalType.VELOCITY
        ).first()

        if not velocity_signal:
            return None

        velocity = velocity_signal.value

        # Check conditions
        velocity_ratio = velocity / stars if stars > 0 else 0
        is_rising = velocity >= RISING_STAR_MIN_VELOCITY or velocity_ratio >= RISING_STAR_VELOCITY_RATIO

        if not is_rising:
            return None

        # Determine severity
        if velocity >= 50 or velocity_ratio >= 0.05:
            severity = EarlySignalSeverity.HIGH
        elif velocity >= 20 or velocity_ratio >= 0.02:
            severity = EarlySignalSeverity.MEDIUM
        else:
            severity = EarlySignalSeverity.LOW

        # Calculate percentile (simplified - based on velocity)
        all_velocities = [
            s.value for s in db.query(Signal).filter(
                Signal.signal_type == SignalType.VELOCITY
            ).all()
        ]
        percentile = (sum(1 for v in all_velocities if v < velocity) / len(all_velocities) * 100) if all_velocities else 0

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
    def detect_sudden_spike(repo: "Repo", db: Session) -> Optional["EarlySignal"]:
        """
        Detect sudden spike pattern.
        Criteria: today_delta > 3x avg_daily AND absolute > 100
        """
        # Get recent snapshots
        snapshots = db.query(RepoSnapshot).filter(
            RepoSnapshot.repo_id == repo.id
        ).order_by(RepoSnapshot.snapshot_date.desc()).limit(30).all()

        if len(snapshots) < 2:
            return None

        # Calculate daily deltas
        deltas = []
        for i in range(len(snapshots) - 1):
            delta = snapshots[i].stars - snapshots[i + 1].stars
            deltas.append(delta)

        if not deltas:
            return None

        latest_delta = deltas[0] if deltas else 0
        avg_delta = sum(deltas[1:]) / len(deltas[1:]) if len(deltas) > 1 else 0

        # Check spike conditions
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
    def detect_breakout(repo: "Repo", db: Session) -> Optional["EarlySignal"]:
        """
        Detect breakout pattern.
        Criteria: prev_week velocity <= 0 AND curr_week velocity > 2
        """
        # Get weekly velocity data
        delta_7d = db.query(Signal).filter(
            Signal.repo_id == repo.id,
            Signal.signal_type == SignalType.STARS_DELTA_7D
        ).first()

        delta_30d = db.query(Signal).filter(
            Signal.repo_id == repo.id,
            Signal.signal_type == SignalType.STARS_DELTA_30D
        ).first()

        if not delta_7d or not delta_30d:
            return None

        current_weekly_velocity = delta_7d.value / 7 if delta_7d.value else 0

        # Estimate prev week velocity from 30d delta
        prev_weeks_velocity = (delta_30d.value - delta_7d.value) / 23 if delta_30d.value else 0

        # Check breakout conditions
        is_breakout = (
            prev_weeks_velocity <= 0 and
            current_weekly_velocity >= BREAKOUT_VELOCITY_THRESHOLD
        )

        if not is_breakout:
            return None

        # Get star count
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
    def detect_viral_hn(repo: "Repo", db: Session) -> Optional["EarlySignal"]:
        """
        Detect viral Hacker News signal.
        Criteria: HN post with score >= 100 in last 48 hours
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

        # Get star count
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
    def detect_all_for_repo(repo: "Repo", db: Session) -> List["EarlySignal"]:
        """
        Run all detection algorithms for a single repo.
        Returns list of detected signals (not yet saved).
        """
        signals: List["EarlySignal"] = []

        # Run each detector (static methods)
        detectors = [
            AnomalyDetector.detect_rising_star,
            AnomalyDetector.detect_sudden_spike,
            AnomalyDetector.detect_breakout,
            AnomalyDetector.detect_viral_hn,
        ]

        for detector in detectors:
            try:
                signal = detector(repo, db)
                if signal:
                    # Check if similar signal already exists
                    existing = db.query(EarlySignal).filter(
                        EarlySignal.repo_id == repo.id,
                        EarlySignal.signal_type == signal.signal_type,
                        EarlySignal.expires_at > utc_now(),
                        EarlySignal.acknowledged == False
                    ).first()

                    if not existing:
                        signals.append(signal)
            except Exception as e:
                logger.error(f"Error in detector for {repo.full_name}: {e}")

        return signals

    def run_detection(self, db: Session) -> Dict[str, Any]:
        """
        Run anomaly detection for all repos.
        Returns summary of detected signals.
        """
        repos = db.query(Repo).all()
        total_signals = 0
        signals_by_type: Dict[str, int] = {}

        for repo in repos:
            try:
                signals = self.detect_all_for_repo(repo, db)
                for signal in signals:
                    db.add(signal)
                    total_signals += 1
                    signals_by_type[signal.signal_type] = signals_by_type.get(signal.signal_type, 0) + 1
            except Exception as e:
                logger.error(f"Failed to detect signals for {repo.full_name}: {e}")

        db.commit()

        logger.info(f"Anomaly detection complete: {total_signals} signals detected")

        return {
            "repos_scanned": len(repos),
            "signals_detected": total_signals,
            "by_type": signals_by_type,
        }


# Module-level singleton
_detector: Optional[AnomalyDetector] = None


def get_anomaly_detector() -> AnomalyDetector:
    """Get the default anomaly detector instance."""
    global _detector
    if _detector is None:
        _detector = AnomalyDetector()
        logger.info("Anomaly detector initialized")
    return _detector


def run_detection(db: Session) -> Dict[str, Any]:
    """Convenience function to run detection."""
    detector = get_anomaly_detector()
    return detector.run_detection(db)
