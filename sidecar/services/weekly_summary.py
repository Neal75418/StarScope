"""
Weekly summary service.
Aggregates weekly changes across all tracked repos.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from db.models import (
    Repo, RepoSnapshot, Signal, TriggeredAlert,
    EarlySignal, ContextSignal,
)
from constants import SignalType, ContextSignalType
from utils.time import utc_now, utc_today

logger = logging.getLogger(__name__)


def get_weekly_summary(db: Session) -> dict[str, Any]:
    """
    Build a weekly summary covering the last 7 days.

    Returns a dict matching the WeeklySummaryResponse schema.
    """
    today = utc_today()
    period_end = today
    period_start = today - timedelta(days=7)
    now = utc_now()
    week_ago = now - timedelta(days=7)

    # --- Total repos ---
    total_repos: int = db.query(func.count(Repo.id)).scalar() or 0

    # --- Stars delta per repo (latest snapshot vs 7-day-ago snapshot) ---
    # Subquery: latest snapshot per repo
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

    # Subquery: snapshot closest to 7 days ago per repo
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

    # Per-repo delta
    repo_deltas: dict[int, int] = {}
    for repo_id, current_stars in latest_map.items():
        old_stars = old_map.get(repo_id)
        if old_stars is not None:
            repo_deltas[repo_id] = current_stars - old_stars

    total_new_stars = sum(repo_deltas.values())

    # --- Signal map for velocity / acceleration / trend ---
    all_signals = db.query(Signal).all()
    signal_map: dict[int, dict[str, float]] = {}
    for sig in all_signals:
        signal_map.setdefault(sig.repo_id, {})[sig.signal_type] = sig.value

    # --- Repo info map ---
    repos = db.query(Repo).all()
    repo_info: dict[int, Repo] = {r.id: r for r in repos}

    def _repo_summary(repo_id: int) -> dict[str, Any]:
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

    # Top gainers (top 5 by 7d delta)
    sorted_by_delta = sorted(repo_deltas.items(), key=lambda x: x[1], reverse=True)
    top_gainers = [_repo_summary(rid) for rid, _ in sorted_by_delta[:5] if repo_deltas[rid] > 0]

    # Top losers (bottom 3 with negative delta)
    top_losers = [
        _repo_summary(rid)
        for rid, delta in reversed(sorted_by_delta)
        if delta < 0
    ][:3]

    # --- Alerts triggered this week ---
    alerts_triggered: int = (
        db.query(func.count(TriggeredAlert.id))
        .filter(TriggeredAlert.triggered_at >= week_ago)
        .scalar()
        or 0
    )

    # --- Early signals detected this week ---
    early_signals = (
        db.query(EarlySignal)
        .filter(EarlySignal.detected_at >= week_ago)
        .all()
    )
    early_signals_detected = len(early_signals)
    early_signals_by_type: dict[str, int] = {}
    for es in early_signals:
        early_signals_by_type[es.signal_type] = early_signals_by_type.get(es.signal_type, 0) + 1

    # --- HN mentions this week ---
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
    hn_mentions = [
        {
            "repo_id": hn.repo_id,
            "repo_name": repo_info[hn.repo_id].full_name if hn.repo_id in repo_info else "unknown",
            "hn_title": hn.title,
            "hn_score": hn.score or 0,
            "hn_url": hn.url,
        }
        for hn in hn_signals
    ]

    # --- Accelerating / decelerating repos ---
    accelerating = 0
    decelerating = 0
    for sigs in signal_map.values():
        acc = sigs.get(SignalType.ACCELERATION, 0)
        if acc > 0:
            accelerating += 1
        elif acc < 0:
            decelerating += 1

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
