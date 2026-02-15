"""
Shared database query utilities.
Centralizes common query patterns to avoid code duplication.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session, Query
from sqlalchemy.sql.selectable import Subquery

from db.models import Signal, RepoSnapshot


def build_signal_map(
    db: Session,
    repo_ids: list[int] | None = None
) -> dict[int, dict[str, float]]:
    """
    Pre-fetch signals and group by repo_id.

    Args:
        db: Database session
        repo_ids: Optional list of repo IDs to filter. If None, fetches all.

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
        rid: int = signal.repo_id  # type: ignore[assignment]
        if rid not in signal_map:
            signal_map[rid] = {}
        signal_map[rid][str(signal.signal_type)] = float(signal.value)

    return signal_map


def _build_latest_snapshot_subquery(
    db: Session,
    repo_ids: list[int] | None = None
) -> Optional[Subquery]:
    """
    Build subquery to get max snapshot_date per repo.
    Shared helper to avoid code duplication.

    Args:
        db: Database session
        repo_ids: Optional list of repo IDs to filter.

    Returns:
        SQLAlchemy subquery for latest snapshot dates
    """
    subq_query: Query[Any] = db.query(
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
    Pre-fetch latest snapshots for repos in a single query.

    Args:
        db: Database session
        repo_ids: Optional list of repo IDs to filter. If None, fetches all.

    Returns:
        {repo_id: RepoSnapshot}
    """
    if repo_ids is not None and not repo_ids:
        return {}

    subq = _build_latest_snapshot_subquery(db, repo_ids)
    if subq is None:
        return {}

    # Join to get full snapshot records
    snapshots = (
        db.query(RepoSnapshot)
        .join(
            subq,
            (RepoSnapshot.repo_id == subq.c.repo_id) &
            (RepoSnapshot.snapshot_date == subq.c.max_date)
        )
        .all()
    )

    return {s.repo_id: s for s in snapshots}  # type: ignore[misc]


def build_stars_map(
    db: Session,
    repo_ids: list[int] | None = None
) -> dict[int, int]:
    """
    Pre-fetch latest snapshot stars for repos.

    Args:
        db: Database session
        repo_ids: Optional list of repo IDs to filter. If None, fetches all.

    Returns:
        {repo_id: stars}
    """
    if repo_ids is not None and not repo_ids:
        return {}

    subq = _build_latest_snapshot_subquery(db, repo_ids)
    if subq is None:
        return {}

    # Join to get stars from latest snapshot
    results = (
        db.query(RepoSnapshot.repo_id, RepoSnapshot.stars)
        .join(
            subq,
            (RepoSnapshot.repo_id == subq.c.repo_id) &
            (RepoSnapshot.snapshot_date == subq.c.max_date)
        )
        .all()
    )

    return {repo_id: stars for repo_id, stars in results}  # type: ignore[misc]


def get_snapshot_for_repo(
    repo_id: int,
    db: Session,
    snapshot_map: Optional[Dict[int, RepoSnapshot]] = None,
) -> Optional[RepoSnapshot]:
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
    signal_map: Optional[Dict[int, Dict[str, float]]] = None,
) -> Optional[float]:
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
