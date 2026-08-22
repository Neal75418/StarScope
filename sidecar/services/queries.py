"""
共用資料庫查詢工具。
集中管理常見查詢模式，避免程式碼重複。
"""

from __future__ import annotations

from sqlalchemy import desc, func
from sqlalchemy.orm import Session, Query, aliased
from sqlalchemy.sql.selectable import Subquery

from constants import SignalType
from db.models import Signal, RepoSnapshot, Repo

# 排序欄位 → SignalType 的映射（trends 與 export 共用）
TREND_SORT_SIGNAL_MAP: dict[str, str] = {
    "velocity": SignalType.VELOCITY,
    "stars_delta_7d": SignalType.STARS_DELTA_7D,
    "stars_delta_30d": SignalType.STARS_DELTA_30D,
    "acceleration": SignalType.ACCELERATION,
    "forks_delta_7d": SignalType.FORKS_DELTA_7D,
    "issues_delta_7d": SignalType.ISSUES_DELTA_7D,
}


def find_empty_trend_sorts(db: Session) -> list[str]:
    """
    找出目前完全沒有訊號的排序鍵。

    這些鍵按下去只會得到空榜單，而前端的空狀態文案講的是「放寬語言或最低星數」
    ——對這個情境是錯的建議，真正的原因是歷史資料還不夠（acceleration 要 14 天
    前的快照、30 天增量要 30 天前的）。前端據此停用對應頁籤並說明原因，
    資料補齊後這個清單會自己變空。
    """
    present = {row[0] for row in db.query(Signal.signal_type).distinct()}
    return [key for key, signal_type in TREND_SORT_SIGNAL_MAP.items() if signal_type not in present]


def query_trending_repos(
    db: Session,
    sort_by: str,
    limit: int,
    language: str | None,
    min_stars: int | None,
) -> list[Repo]:
    """
    查詢並回傳依指定訊號排序的趨勢 repo 列表。
    供 trends 與 export 路由共用，避免重複的 JOIN / filter 邏輯。
    """
    sort_signal_type = TREND_SORT_SIGNAL_MAP.get(sort_by, SignalType.VELOCITY)
    sort_signal = aliased(Signal)

    # INNER JOIN 而非 OUTER：沒有這個指標的 repo 不該出現在「依這個指標排序」的
    # 榜單上。原本是 OUTER JOIN 配 coalesce(value, 0)，把「沒資料」當成「零成長」，
    # 於是 2026-08-22 的 30 天榜第 5 名是七天只漲 62 顆星的專案，而漲了 2,033 的
    # 不在前六——因為 signals 表裡根本沒有半筆 stars_delta_30d，全部並列 0，
    # 順序由資料庫決定，看起來卻像一份真的排行。
    query = (
        db.query(Repo)
        .join(
            sort_signal,
            (Repo.id == sort_signal.repo_id) &
            (sort_signal.signal_type == sort_signal_type)
        )
    )

    if language:
        query = query.filter(func.lower(Repo.language) == language.lower())

    if min_stars is not None:
        query = query.filter(
            db.query(RepoSnapshot.id)
            .filter(
                RepoSnapshot.repo_id == Repo.id,
                RepoSnapshot.stars >= min_stars
            ).exists()
        )

    # INNER JOIN 之後 value 必然存在（Signal.value 是 nullable=False），
    # 不需要 coalesce
    return (
        query
        .order_by(desc(sort_signal.value))
        .limit(limit)
        .all()
    )


def build_signal_map(
    db: Session,
    repo_ids: list[int] | None = None
) -> dict[int, dict[str, float]]:
    """
    預先載入 signals 並依 repo_id 分組。

    Args:
        db: 資料庫 session
        repo_ids: 可選的 repo ID 列表。為 None 時載入全部。

    Returns:
        {repo_id: {signal_type: value}}
    """
    query = db.query(Signal)

    if repo_ids is not None:
        if not repo_ids:
            return {}
        query = query.filter(Signal.repo_id.in_(repo_ids))

    all_signals = query.all()
    signal_map: dict[int, dict[str, float]] = {}

    for signal in all_signals:
        rid: int = signal.repo_id
        if rid not in signal_map:
            signal_map[rid] = {}
        # noinspection PyTypeChecker
        signal_map[rid][str(signal.signal_type)] = float(signal.value)

    return signal_map


def _build_latest_snapshot_subquery(
    db: Session,
    repo_ids: list[int] | None = None
) -> Subquery | None:
    """
    建立子查詢，取得每個 repo 的最新 snapshot_date。
    共用輔助函式，避免程式碼重複。

    Args:
        db: 資料庫 session
        repo_ids: 可選的 repo ID 列表。

    Returns:
        最新快照日期的 SQLAlchemy 子查詢
    """
    subq_query: Query = db.query(
        RepoSnapshot.repo_id,
        func.max(RepoSnapshot.snapshot_date).label("max_date")
    )

    if repo_ids is not None:
        if not repo_ids:
            return None
        subq_query = subq_query.filter(RepoSnapshot.repo_id.in_(repo_ids))

    return subq_query.group_by(RepoSnapshot.repo_id).subquery()


def build_snapshot_map(
    db: Session,
    repo_ids: list[int] | None = None
) -> dict[int, RepoSnapshot]:
    """
    以單一查詢預先載入各 repo 的最新快照。

    Args:
        db: 資料庫 session
        repo_ids: 可選的 repo ID 列表。為 None 時載入全部。

    Returns:
        {repo_id: RepoSnapshot}
    """
    if repo_ids is not None and not repo_ids:
        return {}

    subq = _build_latest_snapshot_subquery(db, repo_ids)
    if subq is None:
        return {}

    # 透過 join 取得完整快照記錄
    snapshots = (
        db.query(RepoSnapshot)
        .join(
            subq,
            (RepoSnapshot.repo_id == subq.c.repo_id) &
            (RepoSnapshot.snapshot_date == subq.c.max_date)
        )
        .all()
    )

    return {s.repo_id: s for s in snapshots}


def build_stars_map(
    db: Session,
    repo_ids: list[int] | None = None
) -> dict[int, int]:
    """
    預先載入各 repo 最新快照的星數。

    Args:
        db: 資料庫 session
        repo_ids: 可選的 repo ID 列表。為 None 時載入全部。

    Returns:
        {repo_id: stars}
    """
    if repo_ids is not None and not repo_ids:
        return {}

    subq = _build_latest_snapshot_subquery(db, repo_ids)
    if subq is None:
        return {}

    # 透過 join 從最新快照取得星數
    results = (
        db.query(RepoSnapshot.repo_id, RepoSnapshot.stars)
        .join(
            subq,
            (RepoSnapshot.repo_id == subq.c.repo_id) &
            (RepoSnapshot.snapshot_date == subq.c.max_date)
        )
        .all()
    )

    return dict(results)  # type: ignore[arg-type]


def get_snapshot_for_repo(
    repo_id: int,
    db: Session,
    snapshot_map: dict[int, RepoSnapshot] | None = None,
) -> RepoSnapshot | None:
    """
    取得指定 repo 的最新快照。
    優先使用預載的 snapshot_map，未命中時查詢資料庫。
    """
    if snapshot_map is not None:
        snapshot = snapshot_map.get(repo_id)
        if snapshot is not None:
            return snapshot
    return (
        db.query(RepoSnapshot)
        .filter(RepoSnapshot.repo_id == repo_id)
        .order_by(RepoSnapshot.snapshot_date.desc())
        .first()
    )


def get_signal_value(
    repo_id: int,
    signal_type: str,
    db: Session,
    signal_map: dict[int, dict[str, float]] | None = None,
) -> float | None:
    """
    取得指定 repo 的特定 signal 值。
    優先使用預載的 signal_map，未命中時查詢資料庫。
    """
    if signal_map is not None:
        val = signal_map.get(repo_id, {}).get(signal_type)
        if val is not None:
            return val
    signal = db.query(Signal).filter(
        Signal.repo_id == repo_id,
        Signal.signal_type == signal_type,
    ).first()
    return signal.value if signal else None
