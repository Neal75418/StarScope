"""
Weekly summary service.
Aggregates weekly changes across all tracked repos.
"""

from __future__ import annotations

import logging
from typing import Any
from datetime import date, datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from db.models import (
    Repo, RepoSnapshot, Signal, TriggeredAlert,
    EarlySignal, ContextSignal,
)
from constants import SignalType, ContextSignalType
from utils.time import utc_now, utc_today

logger = logging.getLogger(__name__)


def _fetch_snapshot_deltas(
    db: Session,
    period_start: date,
) -> tuple[dict[int, int], dict[int, int], dict[int, int], int]:
    """取得每個 repo 的最新 / 7 天前快照並計算星數差異。

    Returns:
        ``(latest_map, old_map, repo_deltas, total_new_stars)``
    """
    # 子查詢：每個 repo 的最新快照
    latest_sub = (
        db.query(
            RepoSnapshot.repo_id,
            func.max(RepoSnapshot.snapshot_date).label("max_date"),
        )
        .group_by(RepoSnapshot.repo_id)
        .subquery()
    )
    latest_snapshots = (
        db.query(RepoSnapshot)
        .join(
            latest_sub,
            (RepoSnapshot.repo_id == latest_sub.c.repo_id)
            & (RepoSnapshot.snapshot_date == latest_sub.c.max_date),
        )
        .all()
    )

    # 子查詢：每個 repo 最接近 7 天前的快照
    old_sub = (
        db.query(
            RepoSnapshot.repo_id,
            func.max(RepoSnapshot.snapshot_date).label("max_date"),
        )
        .filter(RepoSnapshot.snapshot_date <= period_start)
        .group_by(RepoSnapshot.repo_id)
        .subquery()
    )
    old_snapshots = (
        db.query(RepoSnapshot)
        .join(
            old_sub,
            (RepoSnapshot.repo_id == old_sub.c.repo_id)
            & (RepoSnapshot.snapshot_date == old_sub.c.max_date),
        )
        .all()
    )

    latest_map: dict[int, int] = {s.repo_id: s.stars for s in latest_snapshots}
    old_map: dict[int, int] = {s.repo_id: s.stars for s in old_snapshots}

    # 每個 repo 的星數差值
    repo_deltas: dict[int, int] = {}
    for repo_id, current_stars in latest_map.items():
        old_stars = old_map.get(repo_id)
        if old_stars is not None:
            repo_deltas[repo_id] = current_stars - old_stars

    total_new_stars = sum(repo_deltas.values())

    return latest_map, old_map, repo_deltas, total_new_stars


def _preload_signal_and_repo_maps(
    db: Session,
) -> tuple[dict[int, dict[str, float]], dict[int, Repo]]:
    """預載入所有訊號與 repo 資訊，以 dict 形式回傳以便快速查詢。

    Returns:
        ``(signal_map, repo_info)``
    """
    all_signals = db.query(Signal).filter(
        Signal.signal_type.in_(["velocity", "trend", "acceleration"])
    ).all()
    signal_map: dict[int, dict[str, float]] = {}
    for sig in all_signals:
        signal_map.setdefault(sig.repo_id, {})[sig.signal_type] = sig.value

    repos = db.query(Repo).all()
    repo_info: dict[int, Repo] = {r.id: r for r in repos}

    return signal_map, repo_info


def _build_repo_summary(
    repo_id: int,
    repo_info: dict[int, Repo],
    latest_map: dict[int, int],
    repo_deltas: dict[int, int],
    signal_map: dict[int, dict[str, float]],
) -> dict[str, Any]:
    """組裝單一 repo 的摘要資訊。"""
    repo = repo_info.get(repo_id)
    sigs = signal_map.get(repo_id, {})
    return {
        "repo_id": repo_id,
        "full_name": repo.full_name if repo else "unknown",
        "stars": latest_map.get(repo_id, 0),
        "stars_delta_7d": repo_deltas.get(repo_id, 0),
        "velocity": round(sigs.get(SignalType.VELOCITY, 0), 2),
        "trend": int(sigs.get(SignalType.TREND, 0)),
    }


def _find_top_movers(
    repo_deltas: dict[int, int],
    repo_info: dict[int, Repo],
    latest_map: dict[int, int],
    signal_map: dict[int, dict[str, float]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """找出星數增長前 5 名與衰退前 3 名的 repo。

    Returns:
        ``(top_gainers, top_losers)``
    """
    sorted_by_delta = sorted(repo_deltas.items(), key=lambda x: x[1], reverse=True)
    top_gainers = [
        _build_repo_summary(rid, repo_info, latest_map, repo_deltas, signal_map)
        for rid, _ in sorted_by_delta[:5]
        if repo_deltas[rid] > 0
    ]

    top_losers = [
        _build_repo_summary(rid, repo_info, latest_map, repo_deltas, signal_map)
        for rid, delta in reversed(sorted_by_delta)
        if delta < 0
    ][:3]

    return top_gainers, top_losers


def _get_alert_and_signal_stats(
    db: Session,
    week_ago: datetime,
) -> tuple[int, int, dict[str, int]]:
    """查詢本週觸發的警報與偵測到的早期訊號。

    Returns:
        ``(alerts_triggered, early_signals_detected, early_signals_by_type)``
    """
    alerts_triggered: int = (
        db.query(func.count(TriggeredAlert.id))
        .filter(TriggeredAlert.triggered_at >= week_ago)
        .scalar()
        or 0
    )

    early_signals = (
        db.query(EarlySignal)
        .filter(EarlySignal.detected_at >= week_ago)
        .all()
    )
    early_signals_detected = len(early_signals)
    early_signals_by_type: dict[str, int] = {}
    for es in early_signals:
        early_signals_by_type[es.signal_type] = early_signals_by_type.get(es.signal_type, 0) + 1

    return alerts_triggered, early_signals_detected, early_signals_by_type


def _get_hn_mentions(
    db: Session,
    week_ago: datetime,
    repo_info: dict[int, Repo],
) -> list[dict[str, Any]]:
    """查詢本週 Hacker News 上的提及（最多 10 筆，依分數排序）。"""
    hn_signals = (
        db.query(ContextSignal)
        .filter(
            ContextSignal.signal_type == ContextSignalType.HACKER_NEWS,
            ContextSignal.fetched_at >= week_ago,
        )
        .order_by(ContextSignal.score.desc().nullslast())
        .limit(10)
        .all()
    )
    return [
        {
            "repo_id": hn.repo_id,
            "repo_name": repo_info[hn.repo_id].full_name if hn.repo_id in repo_info else "unknown",
            "hn_title": hn.title,
            "hn_score": hn.score or 0,
            "hn_url": hn.url,
        }
        for hn in hn_signals
    ]


def _count_acceleration(
    signal_map: dict[int, dict[str, float]],
) -> tuple[int, int]:
    """統計加速 / 減速中的 repo 數量。

    Returns:
        ``(accelerating, decelerating)``
    """
    accelerating = 0
    decelerating = 0
    for sigs in signal_map.values():
        acc = sigs.get(SignalType.ACCELERATION, 0)
        if acc > 0:
            accelerating += 1
        elif acc < 0:
            decelerating += 1
    return accelerating, decelerating


def get_weekly_summary(db: Session, days: int = 7) -> dict[str, Any]:
    """
    Build a summary covering the last N days.

    Args:
        days: Number of days to cover (default 7).

    Returns a dict matching the WeeklySummaryResponse schema.
    """
    today = utc_today()
    period_end = today
    period_start = today - timedelta(days=days)
    now = utc_now()
    week_ago = now - timedelta(days=days)

    # --- Repo 總數 ---
    total_repos: int = db.query(func.count(Repo.id)).scalar() or 0

    # --- 每個 repo 的星數差值（最新快照 vs N 天前快照）---
    latest_map, old_map, repo_deltas, total_new_stars = _fetch_snapshot_deltas(db, period_start)

    # --- 訊號對映 & repo 資訊 ---
    signal_map, repo_info = _preload_signal_and_repo_maps(db)

    # --- 漲幅 / 跌幅排行 ---
    top_gainers, top_losers = _find_top_movers(repo_deltas, repo_info, latest_map, signal_map)

    # --- 警報 & 早期訊號 ---
    alerts_triggered, early_signals_detected, early_signals_by_type = _get_alert_and_signal_stats(db, week_ago)

    # --- HN 提及 ---
    hn_mentions = _get_hn_mentions(db, week_ago, repo_info)

    # --- 加速 / 減速中的 repo ---
    accelerating, decelerating = _count_acceleration(signal_map)

    return {
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "total_repos": total_repos,
        "total_new_stars": total_new_stars,
        "top_gainers": top_gainers,
        "top_losers": top_losers,
        "alerts_triggered": alerts_triggered,
        "early_signals_detected": early_signals_detected,
        "early_signals_by_type": early_signals_by_type,
        "hn_mentions": hn_mentions,
        "accelerating": accelerating,
        "decelerating": decelerating,
    }
