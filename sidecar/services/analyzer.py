"""
StarScope 的訊號計算引擎。

計算指標包含：
- stars_delta_7d：7 天 star 變化量
- stars_delta_30d：30 天 star 變化量
- velocity：每日 star 增量
- acceleration：velocity 的變化率
- trend：整體趨勢方向（-1, 0, 1）
"""

from datetime import date, timedelta
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import desc
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from constants import SignalType
from db.models import RepoSnapshot, Signal
from utils.time import utc_now, utc_today
from constants import (
    TREND_VELOCITY_UPWARD_THRESHOLD,
    TREND_VELOCITY_DOWNWARD_THRESHOLD,
    TREND_ACCELERATION_DECLINE_THRESHOLD,
    TREND_STRONG_DECLINE_THRESHOLD,
)


def get_snapshot_for_date(
    repo_id: int,
    target_date: date,
    db: Session,
    allow_earlier: bool = True
) -> Optional[RepoSnapshot]:
    """
    取得指定日期的快照。
    若 allow_earlier 為 True 且無完全匹配，取最接近的較早快照。
    """
    # 先嘗試完全匹配
    snapshot = (
        db.query(RepoSnapshot)
        .filter(RepoSnapshot.repo_id == repo_id, RepoSnapshot.snapshot_date == target_date)
        .first()
    )

    if snapshot or not allow_earlier:
        return snapshot

    # 取得最接近的較早快照
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
    計算指定天數的 star 差值。
    資料不足時回傳 None。
    """
    today = utc_today()
    past_date = today - timedelta(days=days)

    current_snapshot = get_snapshot_for_date(repo_id, today, db)
    past_snapshot = get_snapshot_for_date(repo_id, past_date, db)

    if not current_snapshot or not past_snapshot:
        return None

    # 若兩個快照為同一天，無法計算差值
    if current_snapshot.snapshot_date == past_snapshot.snapshot_date:
        return 0.0

    return float(current_snapshot.stars - past_snapshot.stars)


def calculate_velocity(
    repo_id: int,
    db: Session,
    days: int = 7
) -> Optional[float]:
    """
    計算指定期間的 velocity（每日 star 數）。
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
    計算 acceleration（velocity 的變化率）。
    比較本週與上週的 velocity，回傳百分比變化。
    """
    today = utc_today()
    one_week_ago = today - timedelta(days=7)
    two_weeks_ago = today - timedelta(days=14)

    # 本週的 velocity
    current_snapshot = get_snapshot_for_date(repo_id, today, db)
    week_ago_snapshot = get_snapshot_for_date(repo_id, one_week_ago, db)

    # 上週的 velocity
    two_week_ago_snapshot = get_snapshot_for_date(repo_id, two_weeks_ago, db)

    if not all([current_snapshot, week_ago_snapshot, two_week_ago_snapshot]):
        return None

    # 計算 velocity
    this_week_delta = current_snapshot.stars - week_ago_snapshot.stars
    last_week_delta = week_ago_snapshot.stars - two_week_ago_snapshot.stars

    this_week_velocity = this_week_delta / 7.0
    last_week_velocity = last_week_delta / 7.0

    # 以百分比變化計算 acceleration
    # 處理邊界情況以避免除以零
    if abs(last_week_velocity) < 0.001:  # 實質為零
        if this_week_velocity > 0.001:
            return 1.0  # 從接近零的基準線強勁成長
        elif this_week_velocity < -0.001:
            return -1.0  # 從接近零的基準線強烈衰退
        return 0.0  # 兩者都接近零 = 穩定

    return (this_week_velocity - last_week_velocity) / abs(last_week_velocity)


def calculate_trend(
    velocity: Optional[float],
    acceleration: Optional[float]
) -> int:
    """
    根據 velocity 與 acceleration 判斷趨勢方向。

    Returns:
        1：上升趨勢（成長中）
        0：穩定
        -1：下降趨勢（衰退中）
    """
    if velocity is None:
        return 0

    # 強勢上升：正向 velocity 且正向 acceleration
    if velocity > TREND_VELOCITY_UPWARD_THRESHOLD and (
        acceleration is None or acceleration > TREND_ACCELERATION_DECLINE_THRESHOLD
    ):
        return 1

    # 強勢下降：負向 velocity 或強烈負向 acceleration
    if velocity < TREND_VELOCITY_DOWNWARD_THRESHOLD or (
        acceleration is not None and acceleration < TREND_STRONG_DECLINE_THRESHOLD
    ):
        return -1

    # 穩定
    return 0


def calculate_signals(repo_id: int, db: Session) -> dict:
    """
    計算 repo 的所有訊號並儲存至資料庫。
    回傳訊號值的字典。
    """
    signals = {}

    # 計算各項訊號
    delta_7d = calculate_delta(repo_id, 7, db)
    delta_30d = calculate_delta(repo_id, 30, db)
    velocity = calculate_velocity(repo_id, db)
    acceleration = calculate_acceleration(repo_id, db)
    trend = calculate_trend(velocity, acceleration)

    # 儲存訊號
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

            # 使用 SQLite 的 INSERT OR REPLACE 模式進行 upsert
            # 此操作為原子性，可防止競態條件
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

    return signals
