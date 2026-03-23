"""
匯出 API 端點。
支援 JSON 及 CSV 格式匯出追蹤清單。
"""

import csv
import io
import json
from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from db.database import get_db
from constants import SignalType
from db.models import Repo, RepoSnapshot
from services.queries import build_snapshot_map, build_signal_map, build_stars_map, query_trending_repos
from utils.time import utc_now

router = APIRouter(prefix="/api/export", tags=["export"])


# OpenAPI 文件用回應模型
class ExportedRepo(BaseModel):
    """匯出的 Repo 資料結構（包含訊號）。"""
    id: int = Field(..., description="Repo ID")
    owner: str = Field(..., description="擁有者")
    name: str = Field(..., description="專案名稱")
    full_name: str = Field(..., description="完整名稱（owner/name）")
    url: str = Field(..., description="GitHub URL")
    description: str | None = Field(None, description="專案描述")
    language: str | None = Field(None, description="主要程式語言")
    topics: str | None = Field(None, description="Topics JSON 字串")
    added_at: str | None = Field(None, description="加入追蹤時間（ISO 格式）")
    updated_at: str | None = Field(None, description="最後更新時間（ISO 格式）")
    stars: int | None = Field(None, description="Star 數量")
    forks: int | None = Field(None, description="Fork 數量")
    stars_delta_7d: float | None = Field(None, description="7 日 Star 增量")
    stars_delta_30d: float | None = Field(None, description="30 日 Star 增量")
    velocity: float | None = Field(None, description="Star 速度")
    acceleration: float | None = Field(None, description="Star 加速度")
    trend: float | None = Field(None, description="趨勢分數")

    model_config = ConfigDict(json_schema_extra={
        "example": {
            "id": 1,
            "owner": "torvalds",
            "name": "linux",
            "full_name": "torvalds/linux",
            "url": "https://github.com/torvalds/linux",
            "description": "Linux kernel source tree",
            "language": "C",
            "topics": '["kernel", "linux", "operating-system"]',
            "added_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-02T00:00:00Z",
            "stars": 150000,
            "forks": 50000,
            "stars_delta_7d": 500.0,
            "stars_delta_30d": 2000.0,
            "velocity": 100.0,
            "acceleration": 5.0,
            "trend": 0.8,
        }
    })


class WatchlistExportResponse(BaseModel):
    """Watchlist JSON 匯出響應。"""
    exported_at: str = Field(..., description="匯出時間（ISO 格式）")
    total: int = Field(..., description="Repo 總數")
    repos: list[ExportedRepo] = Field(..., description="Repo 列表（含訊號）")

    model_config = ConfigDict(json_schema_extra={
        "example": {
            "exported_at": "2024-01-15T12:00:00Z",
            "total": 42,
            "repos": [
                {
                    "id": 1,
                    "owner": "torvalds",
                    "name": "linux",
                    "full_name": "torvalds/linux",
                    "url": "https://github.com/torvalds/linux",
                    "description": "Linux kernel source tree",
                    "language": "C",
                    "stars": 150000,
                    "velocity": 100.0,
                }
            ]
        }
    })


def _build_repo_dict(
    repo: "Repo",
    snapshot: "RepoSnapshot | None",
    signals: dict[str, float]
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


def _get_repos_with_signals(repos: list["Repo"], db: Session) -> list[dict]:
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


@router.get(
    "/watchlist.json",
    response_class=StreamingResponse,
    responses={
        200: {
            "description": "JSON 格式的 watchlist 匯出",
            "model": WatchlistExportResponse,
        }
    }
)
async def export_watchlist_json(
    db: Session = Depends(get_db)
):
    """
    將整個追蹤清單匯出為 JSON。

    回傳包含所有追蹤 repo 及其訊號（velocity、delta 等）的 JSON 檔案。
    檔名格式：starscope_watchlist_YYYYMMDD.json
    """
    # noinspection PyTypeChecker
    repos: list[Repo] = db.query(Repo).order_by(Repo.added_at.desc()).all()
    data = {
        "exported_at": utc_now().isoformat(),
        "total": len(repos),
        "repos": _get_repos_with_signals(repos, db),
    }

    return StreamingResponse(
        io.StringIO(json.dumps(data, indent=2, ensure_ascii=False)),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="starscope_watchlist_{utc_now().strftime("%Y%m%d")}.json"'
        }
    )


CSV_COLUMNS = [
    "full_name", "owner", "name", "url", "language", "description",
    "stars", "forks", "velocity", "stars_delta_7d", "stars_delta_30d",
    "acceleration", "trend", "added_at",
]


@router.get(
    "/watchlist.csv",
    response_class=StreamingResponse,
    responses={
        200: {
            "description": "CSV 格式的 watchlist 匯出",
            "content": {
                "text/csv": {
                    "schema": {
                        "type": "string",
                        "format": "binary",
                        "description": "CSV 檔案，包含欄位：full_name, owner, name, url, language, description, stars, forks, velocity, stars_delta_7d, stars_delta_30d, acceleration, trend, added_at"
                    },
                    "example": "full_name,owner,name,url,language,stars,velocity\ntorvalds/linux,torvalds,linux,https://github.com/torvalds/linux,C,150000,100.0\n"
                }
            }
        }
    }
)
async def export_watchlist_csv(
    db: Session = Depends(get_db)
):
    """
    將整個追蹤清單匯出為 CSV。

    回傳包含所有追蹤 repo 及其訊號的 CSV 檔案。
    欄位：full_name, owner, name, url, language, description, stars, forks, velocity, stars_delta_7d, stars_delta_30d, acceleration, trend, added_at
    檔名格式：starscope_watchlist_YYYYMMDD.csv
    """
    # noinspection PyTypeChecker
    repos: list[Repo] = db.query(Repo).order_by(Repo.added_at.desc()).all()
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
            "Content-Disposition": f'attachment; filename="starscope_watchlist_{utc_now().strftime("%Y%m%d")}.csv"'
        }
    )


# ──────────────────────────────────────────────────────────────
# 趨勢匯出
# ──────────────────────────────────────────────────────────────

TrendsSortBy = Literal[
    "velocity", "stars_delta_7d", "stars_delta_30d",
    "acceleration", "forks_delta_7d", "issues_delta_7d",
]


def _build_trending_repo_dicts(
    repos: list,
    db: Session,
) -> list[dict]:
    """Repos 列表 → 含訊號的 dict 列表（供 JSON/CSV 匯出）。"""
    if not repos:
        return []
    repo_ids = [r.id for r in repos]
    signals_map = build_signal_map(db, repo_ids)
    stars_map = build_stars_map(db, repo_ids)
    return [
        {
            "rank": rank,
            "full_name": repo.full_name,
            "owner": repo.owner,
            "name": repo.name,
            "url": repo.url,
            "description": repo.description,
            "language": repo.language,
            "stars": stars_map.get(int(repo.id)),
            "velocity": signals_map.get(int(repo.id), {}).get(SignalType.VELOCITY),
            "stars_delta_7d": signals_map.get(int(repo.id), {}).get(SignalType.STARS_DELTA_7D),
            "stars_delta_30d": signals_map.get(int(repo.id), {}).get(SignalType.STARS_DELTA_30D),
            "acceleration": signals_map.get(int(repo.id), {}).get(SignalType.ACCELERATION),
            "forks_delta_7d": signals_map.get(int(repo.id), {}).get(SignalType.FORKS_DELTA_7D),
            "issues_delta_7d": signals_map.get(int(repo.id), {}).get(SignalType.ISSUES_DELTA_7D),
        }
        for rank, repo in enumerate(repos, start=1)
    ]


TRENDS_CSV_COLUMNS = [
    "rank", "full_name", "owner", "name", "url", "language", "description",
    "stars", "velocity", "stars_delta_7d", "stars_delta_30d",
    "acceleration", "forks_delta_7d", "issues_delta_7d",
]


@router.get("/trends.json", response_class=StreamingResponse)
async def export_trends_json(
    sort_by: TrendsSortBy = Query("velocity", description="Sort metric"),
    limit: int = Query(50, ge=1, le=200, description="Maximum results"),
    language: str | None = Query(None, description="Filter by language"),
    min_stars: int | None = Query(None, ge=0, description="Minimum stars"),
    db: Session = Depends(get_db),
):
    """匯出趨勢 repo 為 JSON。"""
    repos = _build_trending_repo_dicts(query_trending_repos(db, sort_by, limit, language, min_stars), db)
    data = {
        "exported_at": utc_now().isoformat(),
        "sort_by": sort_by,
        "total": len(repos),
        "repos": repos,
    }
    return StreamingResponse(
        io.StringIO(json.dumps(data, indent=2, ensure_ascii=False)),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="starscope_trends_{utc_now().strftime("%Y%m%d")}.json"'
        }
    )


@router.get("/trends.csv", response_class=StreamingResponse)
async def export_trends_csv(
    sort_by: TrendsSortBy = Query("velocity", description="Sort metric"),
    limit: int = Query(50, ge=1, le=200, description="Maximum results"),
    language: str | None = Query(None, description="Filter by language"),
    min_stars: int | None = Query(None, ge=0, description="Minimum stars"),
    db: Session = Depends(get_db),
):
    """匯出趨勢 repo 為 CSV。"""
    repos = _build_trending_repo_dicts(query_trending_repos(db, sort_by, limit, language, min_stars), db)
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=TRENDS_CSV_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for repo_dict in repos:
        writer.writerow(repo_dict)
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="starscope_trends_{utc_now().strftime("%Y%m%d")}.csv"'
        }
    )


