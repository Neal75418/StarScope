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
from sqlalchemy import delete, desc
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
    snap_by_date: dict[date, "RepoSnapshot"] | None = None,
) -> float | None:
    """
    計算指定天數的指標差值。
    field 可為 "stars"、"forks"、"open_issues"。
    資料不足時回傳 None。
    snap_by_date: 預載的快照 dict（date → RepoSnapshot），避免重複 DB 查詢。
    """
    pair = _snapshot_pair(repo_id, days, db, snap_by_date)
    if pair is None:
        return None
    current_snapshot, past_snapshot = pair

    # 兩個快照為同一天：視為無變化（delta=0），與「資料不足回 None」有意區分
    if _span_days(current_snapshot, past_snapshot) < 1:
        return 0.0

    # 刻意不按實際跨距縮放：這是「我實際有的兩個快照之間增加了多少」的計數，
    # 把 9 天的真實成長縮成 7 天等於發明資料。回溯上限就是這個近似的界線
    # （weekly_summary._fetch_snapshot_deltas 有同款的取捨說明）。
    # 速率類（velocity / acceleration）不同，它們必須除以實際跨距。
    return float(getattr(current_snapshot, field) - getattr(past_snapshot, field))


def _find_snapshot(
    snap_by_date: dict[date, "RepoSnapshot"],
    target_date: date,
    max_backtrack_days: int,
) -> "RepoSnapshot | None":
    """從預載的快照 dict 找到最接近 target_date 的快照（等於或更早）。

    回溯上限由呼叫端給，因為它必須跟窗口成比例：七日窗回溯七天，誤差最多一倍；
    單日窗回溯七天是七倍誤差，而那個被放大的成長會直接變成排行的第一名。
    """
    snap = snap_by_date.get(target_date)
    if snap:
        return snap
    for offset in range(1, max_backtrack_days + 1):
        earlier = target_date - timedelta(days=offset)
        snap = snap_by_date.get(earlier)
        if snap:
            return snap
    return None


def _snapshot_pair(
    repo_id: int,
    days: int,
    db: Session,
    snap_by_date: dict[date, "RepoSnapshot"] | None = None,
) -> "tuple[RepoSnapshot, RepoSnapshot] | None":
    """取出 (今天, days 天前) 這一對快照；任一端缺就回 None。

    ⚠️ 兩端都可能回溯到更早的快照，所以**實際間隔不一定等於 days**。
    需要速率的呼叫端一律用 _span_days 取實際間隔，不要拿 days 當分母。
    """
    today = utc_today()
    past_date = today - timedelta(days=days)

    if snap_by_date is not None:
        # 與窗口成比例，但保留原本的絕對上限：只寫 days // 2 會把三十日窗的回溯
        # 放寬到十五天，修好短窗卻弄壞長窗
        backtrack = min(days // 2, 7)
        current_snapshot = _find_snapshot(snap_by_date, today, 0)
        past_snapshot = _find_snapshot(snap_by_date, past_date, backtrack)
    else:
        current_snapshot = get_snapshot_for_date(repo_id, today, db)
        past_snapshot = get_snapshot_for_date(repo_id, past_date, db)

    if not current_snapshot or not past_snapshot:
        return None
    return current_snapshot, past_snapshot


def _span_days(newer: "RepoSnapshot", older: "RepoSnapshot") -> int:
    """兩個快照之間的實際天數。速率的分母只能是這個，不能是名目窗口。"""
    return (newer.snapshot_date - older.snapshot_date).days


def calculate_velocity(
    repo_id: int,
    db: Session,
    days: int = 7,
    snap_by_date: dict[date, "RepoSnapshot"] | None = None,
) -> float | None:
    """
    計算指定期間的 velocity（每日 star 數）。

    分母是兩個快照的**實際間隔**，不是 days：抓取只在 App 或 collector 執行時進行，
    快照缺口是常態，而回溯之後跨距經常大於名目窗口。除以 days 會讓跨 9 天的成長
    少算 22%，而畫面上看不出任何異常。
    """
    pair = _snapshot_pair(repo_id, days, db, snap_by_date)
    if pair is None:
        return None
    current_snapshot, past_snapshot = pair

    span = _span_days(current_snapshot, past_snapshot)
    if span < 1:
        return 0.0
    return float(current_snapshot.stars - past_snapshot.stars) / span


def calculate_acceleration(
    repo_id: int,
    db: Session,
    snap_by_date: dict[date, "RepoSnapshot"] | None = None,
) -> float | None:
    """
    計算 acceleration（velocity 的變化率）。
    比較本週與上週的 velocity，回傳百分比變化。
    """
    today = utc_today()
    one_week_ago = today - timedelta(days=7)
    two_weeks_ago = today - timedelta(days=14)

    if snap_by_date is not None:
        current_snapshot = _find_snapshot(snap_by_date, today, 0)
        week_ago_snapshot = _find_snapshot(snap_by_date, one_week_ago, 3)
        two_week_ago_snapshot = _find_snapshot(snap_by_date, two_weeks_ago, 7)
    else:
        current_snapshot = get_snapshot_for_date(repo_id, today, db)
        week_ago_snapshot = get_snapshot_for_date(repo_id, one_week_ago, db)
        two_week_ago_snapshot = get_snapshot_for_date(repo_id, two_weeks_ago, db)

    if not all([current_snapshot, week_ago_snapshot, two_week_ago_snapshot]):
        return None

    # 每一週各自除以自己的實際跨距，不是寫死的 7.0。
    # 2026-09-08 的真實後果：08-24／08-25 沒有快照，那天的 today-14 正好落在 08-25，
    # 回溯到 08-23 之後上週 velocity 被灌水 9/7 倍，97 個 repo 有 55 個被標成
    # 「動能下降」（三天前是 30 個）——一個完全不存在的集體衰退。
    this_span = _span_days(current_snapshot, week_ago_snapshot)
    last_span = _span_days(week_ago_snapshot, two_week_ago_snapshot)
    if this_span < 1 or last_span < 1:
        # 兩端撞在同一筆快照上：比不出「週對週」，而除以零會讓整輪收集掛掉
        return None

    this_week_velocity = (current_snapshot.stars - week_ago_snapshot.stars) / this_span
    last_week_velocity = (week_ago_snapshot.stars - two_week_ago_snapshot.stars) / last_span

    # 以百分比變化計算 acceleration。上週實質為零時比例沒有定義：
    # 先前回 ±1.0 當暗號，前端顯示成 ±100%，跟「每天 5 顆變 10 顆」的真實 +100% 撞在
    # 同一個值上，永遠分不出來（實測 3/94 個 repo 中招）。回 None 讓消費端顯示「—」；
    # calculate_trend 對 None 本來就是「沒有加速度資訊」，零活動的 repo 會判穩定而不是
    # 靠暗號判成強烈衰退。兩週都沒動則是真的「沒變」，0 是誠實的
    if abs(last_week_velocity) < 0.001:  # 實質為零
        if abs(this_week_velocity) < 0.001:
            return 0.0
        return None

    return (this_week_velocity - last_week_velocity) / abs(last_week_velocity)


def calculate_trend(
    velocity: float | None,
    acceleration: float | None
) -> int:
    """
    根據 velocity 與 acceleration 判斷「動能」方向。

    ⚠️ 方向講的是成長率的變化，不是星數增減。星數持續增加、但增速明顯放緩的
    專案會回 -1，這是刻意的：實測 deepseek-harness 上週每日 +10,140、本週
    +2,541，acceleration -0.75（成長率掉 75%）⇒ -1，即使 7 天仍 +17.7K。

    acceleration 是 calculate_acceleration 算出的「週對週成長率變化比例」
    （不是 stars/day²），所以下面的門檻與它量綱一致，不需要再除以 velocity。

    Returns:
        1：動能上升（還在加速，或減速幅度不到 10%）
        0：穩定
        -1：動能下降（星數在減少，或成長率掉超過 30%）
    """
    if velocity is None:
        return 0

    # 上升：velocity 高於門檻，且未明顯減速（acceleration 缺值時視為未減速放行）
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
    快照以一次查詢預載，避免逐訊號查 DB。
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
    delta_1d = calculate_delta(repo_id, 1, db, snap_by_date=snap_by_date)
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
        (SignalType.STARS_DELTA_1D, delta_1d),
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

    # 這一輪算不出來的訊號（例如 acceleration 的基準線為零、快照不足 30 天）不能只是
    # 「不寫」：上一輪寫進去的值會留著，畫面一直顯示過時的數字。明確刪掉，消費端才會
    # 拿到「沒有值」
    stale_types = [signal_type for signal_type, value in signal_values if value is None]
    if stale_types:
        db.execute(
            delete(Signal).where(Signal.repo_id == repo_id, Signal.signal_type.in_(stale_types))
        )

    for signal_type, value in signal_values:
        if value is not None:
            signals[signal_type] = value

            # 使用 SQLite 的 INSERT ... ON CONFLICT DO UPDATE 進行 upsert
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
