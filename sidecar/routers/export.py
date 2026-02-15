"""
匯出 API 端點。
支援 JSON 及 CSV 格式匯出追蹤清單。
"""

import csv
import io
import json
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from db.database import get_db
from constants import SignalType
from db.models import Repo, RepoSnapshot
from services.queries import build_snapshot_map, build_signal_map
from utils.time import utc_now

router = APIRouter(prefix="/api/export", tags=["export"])


def _build_repo_dict(
    repo: "Repo",
    snapshot: Optional["RepoSnapshot"],
    signals: Dict[str, float]
) -> dict:
    """從預先載入的資料建立 repo 字典。"""
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
    """使用批次載入建立含訊號的 repo 字典以避免 N+1 查詢。"""
    if not repos:
        return []

    repo_ids = [r.id for r in repos]

    # 以 2 次查詢批次載入所有資料，取代 2N 次查詢
    snapshots_map = build_snapshot_map(db, repo_ids)
    signals_map = build_signal_map(db, repo_ids)

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
    將整個追蹤清單匯出為 JSON。
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


CSV_COLUMNS = [
    "full_name", "owner", "name", "url", "language", "description",
    "stars", "forks", "velocity", "stars_delta_7d", "stars_delta_30d",
    "acceleration", "trend", "added_at",
]


@router.get("/watchlist.csv")
async def export_watchlist_csv(
    db: Session = Depends(get_db)
):
    """
    將整個追蹤清單匯出為 CSV。
    """
    repos = db.query(Repo).order_by(Repo.added_at.desc()).all()
    repo_dicts = _get_repos_with_signals(repos, db)

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=CSV_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for repo_dict in repo_dicts:
        writer.writerow(repo_dict)

    output.seek(0)
    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="starscope_watchlist_{datetime.now().strftime("%Y%m%d")}.csv"'
        }
    )
