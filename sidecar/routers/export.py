"""
Export API endpoints.
Simplified to only export watchlist as JSON.
"""

import io
import json
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Repo, RepoSnapshot, Signal, SignalType
from utils.time import utc_now

router = APIRouter(prefix="/export", tags=["export"])


def _batch_load_latest_snapshots(repo_ids: List[int], db: Session) -> Dict[int, "RepoSnapshot"]:
    """Batch load latest snapshots for multiple repos to avoid N+1 queries."""
    if not repo_ids:
        return {}

    # Subquery to get the latest snapshot date for each repo
    latest_dates = db.query(
        RepoSnapshot.repo_id,
        func.max(RepoSnapshot.snapshot_date).label("max_date")
    ).filter(
        RepoSnapshot.repo_id.in_(repo_ids)
    ).group_by(RepoSnapshot.repo_id).subquery()

    # Join to get the actual snapshots
    snapshots = db.query(RepoSnapshot).join(
        latest_dates,
        (RepoSnapshot.repo_id == latest_dates.c.repo_id) &
        (RepoSnapshot.snapshot_date == latest_dates.c.max_date)
    ).all()

    return {s.repo_id: s for s in snapshots}


def _batch_load_signals(repo_ids: List[int], db: Session) -> Dict[int, Dict[str, float]]:
    """Batch load all signals for multiple repos to avoid N+1 queries."""
    if not repo_ids:
        return {}

    signals = db.query(Signal).filter(Signal.repo_id.in_(repo_ids)).all()

    result: Dict[int, Dict[str, float]] = {}
    for s in signals:
        if s.repo_id not in result:
            result[s.repo_id] = {}
        result[s.repo_id][s.signal_type] = s.value

    return result


def _build_repo_dict(
    repo: "Repo",
    snapshot: Optional["RepoSnapshot"],
    signals: Dict[str, float]
) -> dict:
    """Build a repo dict from pre-loaded data."""
    return {
        "id": repo.id,
        "owner": repo.owner,
        "name": repo.name,
        "full_name": repo.full_name,
        "url": repo.url,
        "description": repo.description,
        "language": repo.language,
        "topics": repo.topics,
        "added_at": repo.added_at.isoformat() if repo.added_at else None,
        "updated_at": repo.updated_at.isoformat() if repo.updated_at else None,
        "stars": snapshot.stars if snapshot else None,
        "forks": snapshot.forks if snapshot else None,
        "stars_delta_7d": signals.get(SignalType.STARS_DELTA_7D),
        "stars_delta_30d": signals.get(SignalType.STARS_DELTA_30D),
        "velocity": signals.get(SignalType.VELOCITY),
        "acceleration": signals.get(SignalType.ACCELERATION),
        "trend": signals.get(SignalType.TREND),
    }


def _get_repos_with_signals(repos: List["Repo"], db: Session) -> List[dict]:
    """Build repo dicts with signals using batch loading to avoid N+1 queries."""
    if not repos:
        return []

    repo_ids = [r.id for r in repos]

    # Batch load all data in 2 queries instead of 2N queries
    snapshots_map = _batch_load_latest_snapshots(repo_ids, db)
    signals_map = _batch_load_signals(repo_ids, db)

    return [
        _build_repo_dict(
            repo,
            snapshots_map.get(repo.id),
            signals_map.get(repo.id, {})
        )
        for repo in repos
    ]


@router.get("/watchlist.json")
async def export_watchlist_json(
    db: Session = Depends(get_db)
):
    """
    Export the entire watchlist as JSON.
    """
    repos = db.query(Repo).order_by(Repo.added_at.desc()).all()
    data = {
        "exported_at": utc_now().isoformat(),
        "total": len(repos),
        "repos": _get_repos_with_signals(repos, db),
    }

    return StreamingResponse(
        io.StringIO(json.dumps(data, indent=2, ensure_ascii=False)),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="starscope_watchlist_{datetime.now().strftime("%Y%m%d")}.json"'
        }
    )
