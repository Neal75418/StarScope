"""
Export API endpoints.
Provides CSV and JSON export for watchlist and historical data.
"""

import csv
import io
import json
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Repo, RepoSnapshot, Signal, SignalType, EarlySignal
from utils.time import utc_now

# Media type constants
MEDIA_TYPE_JSON = "application/json"
MEDIA_TYPE_CSV = "text/csv"

# Error message constants
ERROR_REPO_NOT_FOUND = "Repository not found"

router = APIRouter(prefix="/export", tags=["export"])


def _get_repo_or_404(repo_id: int, db: Session) -> "Repo":
    """Get repo by ID or raise 404."""
    repo = db.query(Repo).filter(Repo.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail=ERROR_REPO_NOT_FOUND)
    return repo


def _get_repo_snapshots(
    repo_id: int, days: int, db: Session
) -> tuple["Repo", List["RepoSnapshot"]]:
    """Get repo and its snapshots, raising 404 if repo not found."""
    repo = _get_repo_or_404(repo_id, db)
    snapshots = db.query(RepoSnapshot).filter(
        RepoSnapshot.repo_id == repo_id
    ).order_by(RepoSnapshot.snapshot_date.desc()).limit(days).all()
    return repo, snapshots


def _sanitize_csv_field(value: Optional[str]) -> str:
    """
    Sanitize a field for CSV export to prevent CSV injection attacks.
    Remove leading characters that could be interpreted as formulas.
    """
    if value is None:
        return ""

    value = str(value)
    # Characters that could trigger formula injection in spreadsheet applications
    dangerous_chars = ('=', '+', '-', '@', '\t', '\r', '\n')

    if value.startswith(dangerous_chars):
        # Prefix with a single quote to prevent formula execution
        return "'" + value

    return value


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
        media_type=MEDIA_TYPE_JSON,
        headers={
            "Content-Disposition": f'attachment; filename="starscope_watchlist_{datetime.now().strftime("%Y%m%d")}.json"'
        }
    )


@router.get("/watchlist.csv")
async def export_watchlist_csv(
    db: Session = Depends(get_db)
):
    """
    Export the entire watchlist as CSV.
    """
    repos = db.query(Repo).order_by(Repo.added_at.desc()).all()
    repos_data = _get_repos_with_signals(repos, db)

    output = io.StringIO()
    writer = csv.writer(output)

    # Header
    writer.writerow([
        "id", "owner", "name", "full_name", "url", "description", "language",
        "stars", "forks", "stars_delta_7d", "stars_delta_30d",
        "velocity", "acceleration", "trend", "added_at", "updated_at"
    ])

    # Rows (using batch-loaded data)
    # Apply CSV sanitization to all string fields that could contain user input
    for data in repos_data:
        writer.writerow([
            data["id"],
            _sanitize_csv_field(data["owner"]),
            _sanitize_csv_field(data["name"]),
            _sanitize_csv_field(data["full_name"]),
            _sanitize_csv_field(data["url"]),
            _sanitize_csv_field(data["description"]),
            _sanitize_csv_field(data["language"]),
            data["stars"], data["forks"], data["stars_delta_7d"],
            data["stars_delta_30d"], data["velocity"], data["acceleration"],
            data["trend"], data["added_at"], data["updated_at"]
        ])

    output.seek(0)
    return StreamingResponse(
        output,
        media_type=MEDIA_TYPE_CSV,
        headers={
            "Content-Disposition": f'attachment; filename="starscope_watchlist_{datetime.now().strftime("%Y%m%d")}.csv"'
        }
    )


@router.get("/history/{repo_id}.json")
async def export_repo_history_json(
    repo_id: int,
    days: int = Query(90, ge=7, le=365, description="Number of days to export"),
    db: Session = Depends(get_db)
):
    """
    Export star history for a specific repository as JSON.
    """
    repo, snapshots = _get_repo_snapshots(repo_id, days, db)

    data = {
        "exported_at": utc_now().isoformat(),
        "repo": {
            "id": repo.id,
            "full_name": repo.full_name,
            "url": repo.url,
        },
        "days": days,
        "total_snapshots": len(snapshots),
        "history": [
            {
                "date": s.snapshot_date.isoformat(),
                "stars": s.stars,
                "forks": s.forks,
            }
            for s in reversed(snapshots)
        ],
    }

    return StreamingResponse(
        io.StringIO(json.dumps(data, indent=2, ensure_ascii=False)),
        media_type=MEDIA_TYPE_JSON,
        headers={
            "Content-Disposition": f'attachment; filename="starscope_{repo.full_name.replace("/", "_")}_{datetime.now().strftime("%Y%m%d")}.json"'
        }
    )


@router.get("/history/{repo_id}.csv")
async def export_repo_history_csv(
    repo_id: int,
    days: int = Query(90, ge=7, le=365, description="Number of days to export"),
    db: Session = Depends(get_db)
):
    """
    Export star history for a specific repository as CSV.
    """
    repo, snapshots = _get_repo_snapshots(repo_id, days, db)

    output = io.StringIO()
    writer = csv.writer(output)

    # Header
    writer.writerow(["date", "stars", "forks"])

    # Rows (chronological order)
    for s in reversed(snapshots):
        writer.writerow([s.snapshot_date.isoformat(), s.stars, s.forks])

    output.seek(0)
    return StreamingResponse(
        output,
        media_type=MEDIA_TYPE_CSV,
        headers={
            "Content-Disposition": f'attachment; filename="starscope_{repo.full_name.replace("/", "_")}_{datetime.now().strftime("%Y%m%d")}.csv"'
        }
    )


@router.get("/signals.json")
async def export_signals_json(
    include_acknowledged: bool = Query(False),
    db: Session = Depends(get_db)
):
    """
    Export all early signals as JSON.
    """
    query = db.query(EarlySignal)
    if not include_acknowledged:
        query = query.filter(EarlySignal.acknowledged.is_(False))

    signals = query.order_by(EarlySignal.detected_at.desc()).all()

    data = {
        "exported_at": utc_now().isoformat(),
        "total": len(signals),
        "signals": [
            {
                "id": s.id,
                "repo_id": s.repo_id,
                "repo_name": s.repo.full_name,
                "signal_type": s.signal_type,
                "severity": s.severity,
                "description": s.description,
                "velocity_value": s.velocity_value,
                "star_count": s.star_count,
                "percentile_rank": s.percentile_rank,
                "detected_at": s.detected_at.isoformat() if s.detected_at else None,
                "expires_at": s.expires_at.isoformat() if s.expires_at else None,
                "acknowledged": bool(s.acknowledged),
            }
            for s in signals
        ],
    }

    return StreamingResponse(
        io.StringIO(json.dumps(data, indent=2, ensure_ascii=False)),
        media_type=MEDIA_TYPE_JSON,
        headers={
            "Content-Disposition": f'attachment; filename="starscope_signals_{datetime.now().strftime("%Y%m%d")}.json"'
        }
    )


@router.get("/signals.csv")
async def export_signals_csv(
    include_acknowledged: bool = Query(False),
    db: Session = Depends(get_db)
):
    """
    Export all early signals as CSV.
    """
    query = db.query(EarlySignal)
    if not include_acknowledged:
        query = query.filter(EarlySignal.acknowledged.is_(False))

    signals = query.order_by(EarlySignal.detected_at.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output)

    # Header
    writer.writerow([
        "id", "repo_id", "repo_name", "signal_type", "severity",
        "description", "velocity_value", "star_count", "percentile_rank",
        "detected_at", "expires_at", "acknowledged"
    ])

    # Rows
    for s in signals:
        writer.writerow([
            s.id, s.repo_id, s.repo.full_name, s.signal_type, s.severity,
            s.description, s.velocity_value, s.star_count, s.percentile_rank,
            s.detected_at.isoformat() if s.detected_at else None,
            s.expires_at.isoformat() if s.expires_at else None,
            bool(s.acknowledged)
        ])

    output.seek(0)
    return StreamingResponse(
        output,
        media_type=MEDIA_TYPE_CSV,
        headers={
            "Content-Disposition": f'attachment; filename="starscope_signals_{datetime.now().strftime("%Y%m%d")}.csv"'
        }
    )


@router.get("/full-report.json")
async def export_full_report_json(
    db: Session = Depends(get_db)
):
    """
    Export a comprehensive report including all data.
    """
    repos = db.query(Repo).order_by(Repo.added_at.desc()).all()
    signals = db.query(EarlySignal).filter(
        EarlySignal.acknowledged.is_(False)
    ).order_by(EarlySignal.detected_at.desc()).all()

    data = {
        "exported_at": utc_now().isoformat(),
        "summary": {
            "total_repos": len(repos),
            "active_signals": len(signals),
        },
        "repos": _get_repos_with_signals(repos, db),
        "signals": [
            {
                "id": s.id,
                "repo_name": s.repo.full_name,
                "signal_type": s.signal_type,
                "severity": s.severity,
                "description": s.description,
                "detected_at": s.detected_at.isoformat() if s.detected_at else None,
            }
            for s in signals
        ],
    }

    return StreamingResponse(
        io.StringIO(json.dumps(data, indent=2, ensure_ascii=False)),
        media_type=MEDIA_TYPE_JSON,
        headers={
            "Content-Disposition": f'attachment; filename="starscope_report_{datetime.now().strftime("%Y%m%d")}.json"'
        }
    )


# ==================== Digest Endpoints ====================

from services.digest import get_digest_service


@router.get("/digest/weekly.json")
async def get_weekly_digest_json(
    db: Session = Depends(get_db)
):
    """
    Get the weekly digest as JSON.
    """
    service = get_digest_service()
    digest = service.generate_weekly_digest(db)
    return digest


@router.get("/digest/weekly.md")
async def get_weekly_digest_markdown(
    db: Session = Depends(get_db)
):
    """
    Get the weekly digest as Markdown.
    """
    service = get_digest_service()
    digest = service.generate_weekly_digest(db)
    markdown = service.render_markdown(digest)

    return StreamingResponse(
        io.StringIO(markdown),
        media_type="text/markdown",
        headers={
            "Content-Disposition": f'attachment; filename="starscope_weekly_{datetime.now().strftime("%Y%m%d")}.md"'
        }
    )


@router.get("/digest/weekly.html")
async def get_weekly_digest_html(
    db: Session = Depends(get_db)
):
    """
    Get the weekly digest as HTML.
    """
    service = get_digest_service()
    digest = service.generate_weekly_digest(db)
    html = service.render_html(digest)

    return StreamingResponse(
        io.StringIO(html),
        media_type="text/html",
        headers={
            "Content-Disposition": f'attachment; filename="starscope_weekly_{datetime.now().strftime("%Y%m%d")}.html"'
        }
    )


@router.get("/digest/daily.json")
async def get_daily_digest_json(
    db: Session = Depends(get_db)
):
    """
    Get the daily digest as JSON.
    """
    service = get_digest_service()
    digest = service.generate_daily_digest(db)
    return digest


@router.get("/digest/daily.md")
async def get_daily_digest_markdown(
    db: Session = Depends(get_db)
):
    """
    Get the daily digest as Markdown.
    """
    service = get_digest_service()
    digest = service.generate_daily_digest(db)
    markdown = service.render_markdown(digest)

    return StreamingResponse(
        io.StringIO(markdown),
        media_type="text/markdown",
        headers={
            "Content-Disposition": f'attachment; filename="starscope_daily_{datetime.now().strftime("%Y%m%d")}.md"'
        }
    )


@router.get("/digest/daily.html")
async def get_daily_digest_html(
    db: Session = Depends(get_db)
):
    """
    Get the daily digest as HTML.
    """
    service = get_digest_service()
    digest = service.generate_daily_digest(db)
    html = service.render_html(digest)

    return StreamingResponse(
        io.StringIO(html),
        media_type="text/html",
        headers={
            "Content-Disposition": f'attachment; filename="starscope_daily_{datetime.now().strftime("%Y%m%d")}.html"'
        }
    )
