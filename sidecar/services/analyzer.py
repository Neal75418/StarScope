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
from sqlalchemy.orm import Session
from sqlalchemy import desc
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from db.models import RepoSnapshot, Signal
from utils.time import utc_now, utc_today
from constants import (
    SignalType,
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
) -> RepoSnapshot | None:
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
    db: Session,
    field: str = "stars",
    snap_by_date: dict | None = None,
) -> float | None:
    """
    計算指定天數的指標差值。
    field 可為 "stars"、"forks"、"open_issues"。
    資料不足時回傳 None。
    snap_by_date: 預載的快照 dict（date → RepoSnapshot），避免重複 DB 查詢。
    """
    today = utc_today()
    past_date = today - timedelta(days=days)

    if snap_by_date is not None:
        current_snapshot = _find_snapshot(snap_by_date, today)
        past_snapshot = _find_snapshot(snap_by_date, past_date)
    else:
        current_snapshot = get_snapshot_for_date(repo_id, today, db)
        past_snapshot = get_snapshot_for_date(repo_id, past_date, db)

    if not current_snapshot or not past_snapshot:
        return None

    # 若兩個快照為同一天，無法計算差值
    if current_snapshot.snapshot_date == past_snapshot.snapshot_date:
        return 0.0

    return float(getattr(current_snapshot, field) - getattr(past_snapshot, field))


def _find_snapshot(snap_by_date: dict, target_date: date) -> "RepoSnapshot | None":
    """從預載的快照 dict 找到最接近 target_date 的快照（等於或更早）。"""
    snap = snap_by_date.get(target_date)
    if snap:
        return snap
    # 向前搜尋最接近的快照（最多 7 天）
    for offset in range(1, 8):
        earlier = target_date - timedelta(days=offset)
        snap = snap_by_date.get(earlier)
        if snap:
            return snap
    return None


def calculate_velocity(
    repo_id: int,
    db: Session,
    days: int = 7,
    snap_by_date: dict | None = None,
) -> float | None:
    """
    計算指定期間的 velocity（每日 star 數）。
    """
    delta = calculate_delta(repo_id, days, db, snap_by_date=snap_by_date)
    if delta is None:
        return None

    return delta / days


def calculate_acceleration(
    repo_id: int,
    db: Session,
    snap_by_date: dict | None = None,
) -> float | None:
    """
    計算 acceleration（velocity 的變化率）。
    比較本週與上週的 velocity，回傳百分比變化。
    """
    today = utc_today()
    one_week_ago = today - timedelta(days=7)
    two_weeks_ago = today - timedelta(days=14)

    if snap_by_date is not None:
        current_snapshot = _find_snapshot(snap_by_date, today)
        week_ago_snapshot = _find_snapshot(snap_by_date, one_week_ago)
        two_week_ago_snapshot = _find_snapshot(snap_by_date, two_weeks_ago)
    else:
        current_snapshot = get_snapshot_for_date(repo_id, today, db)
        week_ago_snapshot = get_snapshot_for_date(repo_id, one_week_ago, db)
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
        return 0.0

    return (this_week_velocity - last_week_velocity) / abs(last_week_velocity)


def calculate_trend(
    velocity: float | None,
    acceleration: float | None
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
    預載所有需要的快照（1 次查詢取代原本 15+ 次）。
    """
    signals = {}

    # 預載此 repo 近 31 天的所有快照（一次查詢）
    today = utc_today()
    snapshots = (
        db.query(RepoSnapshot)
        .filter(
            RepoSnapshot.repo_id == repo_id,
            RepoSnapshot.snapshot_date >= today - timedelta(days=31),
        )
        .all()
    )
    snap_by_date = {s.snapshot_date: s for s in snapshots}

    # 計算各項訊號（使用預載快照，無額外 DB 查詢）
    delta_7d = calculate_delta(repo_id, 7, db, snap_by_date=snap_by_date)
    delta_30d = calculate_delta(repo_id, 30, db, snap_by_date=snap_by_date)
    velocity = calculate_velocity(repo_id, db, snap_by_date=snap_by_date)
    acceleration = calculate_acceleration(repo_id, db, snap_by_date=snap_by_date)
    trend = calculate_trend(velocity, acceleration)

    # Fork 與 Issue 差值
    forks_delta_7d = calculate_delta(repo_id, 7, db, "forks", snap_by_date=snap_by_date)
    forks_delta_30d = calculate_delta(repo_id, 30, db, "forks", snap_by_date=snap_by_date)
    issues_delta_7d = calculate_delta(repo_id, 7, db, "open_issues", snap_by_date=snap_by_date)
    issues_delta_30d = calculate_delta(repo_id, 30, db, "open_issues", snap_by_date=snap_by_date)

    # 儲存訊號
    signal_values = [
        (SignalType.STARS_DELTA_7D, delta_7d),
        (SignalType.STARS_DELTA_30D, delta_30d),
        (SignalType.VELOCITY, velocity),
        (SignalType.ACCELERATION, acceleration),
        (SignalType.TREND, float(trend)),
        (SignalType.FORKS_DELTA_7D, forks_delta_7d),
        (SignalType.FORKS_DELTA_30D, forks_delta_30d),
        (SignalType.ISSUES_DELTA_7D, issues_delta_7d),
        (SignalType.ISSUES_DELTA_30D, issues_delta_30d),
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
