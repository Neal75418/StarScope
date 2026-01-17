"""
Signal calculation engine for StarScope.

Calculates metrics like:
- stars_delta_7d: Star change over 7 days
- stars_delta_30d: Star change over 30 days
- velocity: Stars gained per day
- acceleration: Rate of change of velocity
- trend: Overall trend direction (-1, 0, 1)
"""

from datetime import date, timedelta
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import desc
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from db.models import RepoSnapshot, Signal, SignalType
from utils.time import utc_now, utc_today


def get_snapshot_for_date(
    repo_id: int,
    target_date: date,
    db: Session,
    allow_earlier: bool = True
) -> Optional[RepoSnapshot]:
    """
    Get a snapshot for a specific date.
    If allow_earlier is True and no exact match, get the closest earlier snapshot.
    """
    # Try exact match first
    snapshot = (
        db.query(RepoSnapshot)
        .filter(RepoSnapshot.repo_id == repo_id, RepoSnapshot.snapshot_date == target_date)
        .first()
    )

    if snapshot or not allow_earlier:
        return snapshot

    # Get closest earlier snapshot
    return (
        db.query(RepoSnapshot)
        .filter(RepoSnapshot.repo_id == repo_id, RepoSnapshot.snapshot_date <= target_date)
        .order_by(desc(RepoSnapshot.snapshot_date))
        .first()
    )


def calculate_delta(
    repo_id: int,
    days: int,
    db: Session
) -> Optional[float]:
    """
    Calculate the star delta over a given number of days.
    Returns None if insufficient data.
    """
    today = utc_today()
    past_date = today - timedelta(days=days)

    current_snapshot = get_snapshot_for_date(repo_id, today, db)
    past_snapshot = get_snapshot_for_date(repo_id, past_date, db)

    if not current_snapshot or not past_snapshot:
        return None

    # If both snapshots are the same (same date), we can't calculate delta
    if current_snapshot.snapshot_date == past_snapshot.snapshot_date:
        return 0.0

    return float(current_snapshot.stars - past_snapshot.stars)


def calculate_velocity(
    repo_id: int,
    db: Session,
    days: int = 7
) -> Optional[float]:
    """
    Calculate velocity (stars per day) over the given period.
    """
    delta = calculate_delta(repo_id, days, db)
    if delta is None:
        return None

    return delta / days


def calculate_acceleration(
    repo_id: int,
    db: Session
) -> Optional[float]:
    """
    Calculate acceleration (rate of change of velocity).
    Compares this week's velocity to last week's velocity.
    Returns percentage change.
    """
    today = utc_today()
    one_week_ago = today - timedelta(days=7)
    two_weeks_ago = today - timedelta(days=14)

    # This week's velocity
    current_snapshot = get_snapshot_for_date(repo_id, today, db)
    week_ago_snapshot = get_snapshot_for_date(repo_id, one_week_ago, db)

    # Last week's velocity
    two_week_ago_snapshot = get_snapshot_for_date(repo_id, two_weeks_ago, db)

    if not all([current_snapshot, week_ago_snapshot, two_week_ago_snapshot]):
        return None

    # Calculate velocities
    this_week_delta = current_snapshot.stars - week_ago_snapshot.stars
    last_week_delta = week_ago_snapshot.stars - two_week_ago_snapshot.stars

    this_week_velocity = this_week_delta / 7.0
    last_week_velocity = last_week_delta / 7.0

    # Calculate acceleration as percentage change
    # Handle edge cases to avoid division by zero
    if abs(last_week_velocity) < 0.001:  # Effectively zero
        if this_week_velocity > 0.001:
            return 1.0  # Strong growth from near-zero baseline
        elif this_week_velocity < -0.001:
            return -1.0  # Strong decline from near-zero baseline
        return 0.0  # Both near zero = stable

    return (this_week_velocity - last_week_velocity) / abs(last_week_velocity)


def calculate_trend(
    velocity: Optional[float],
    acceleration: Optional[float]
) -> int:
    """
    Determine trend direction based on velocity and acceleration.
    Returns:
        1: Upward trend (growing)
        0: Stable
        -1: Downward trend (declining)
    """
    if velocity is None:
        return 0

    # Strong upward: positive velocity and positive acceleration
    if velocity > 0.5 and (acceleration is None or acceleration > -0.1):
        return 1

    # Strong downward: negative velocity or strongly negative acceleration
    if velocity < -0.5 or (acceleration is not None and acceleration < -0.3):
        return -1

    # Stable
    return 0


def calculate_signals(repo_id: int, db: Session) -> dict:
    """
    Calculate all signals for a repository and store them in the database.
    Returns a dictionary of signal values.
    """
    signals = {}

    # Calculate each signal
    delta_7d = calculate_delta(repo_id, 7, db)
    delta_30d = calculate_delta(repo_id, 30, db)
    velocity = calculate_velocity(repo_id, db)
    acceleration = calculate_acceleration(repo_id, db)
    trend = calculate_trend(velocity, acceleration)

    # Store signals
    signal_values = [
        (SignalType.STARS_DELTA_7D, delta_7d),
        (SignalType.STARS_DELTA_30D, delta_30d),
        (SignalType.VELOCITY, velocity),
        (SignalType.ACCELERATION, acceleration),
        (SignalType.TREND, float(trend)),
    ]

    for signal_type, value in signal_values:
        if value is not None:
            signals[signal_type] = value

            # Upsert signal using SQLite's INSERT OR REPLACE pattern
            # This is atomic and prevents race conditions
            stmt = sqlite_insert(Signal).values(
                repo_id=repo_id,
                signal_type=signal_type,
                value=value,
                calculated_at=utc_now(),
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["repo_id", "signal_type"],
                set_={
                    "value": stmt.excluded.value,
                    "calculated_at": stmt.excluded.calculated_at,
                },
            )
            db.execute(stmt)

    db.commit()
    return signals
