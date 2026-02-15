"""
追蹤清單 API 端點，管理 GitHub repo。
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import List, Optional, Dict
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session
from sqlalchemy import desc

from db import get_db, Repo, RepoSnapshot
from middleware.rate_limit import limiter
from schemas import RepoCreate, RepoWithSignals, RepoListResponse
from constants import (
    SignalType,
    GITHUB_USERNAME_PATTERN,
    GITHUB_REPO_NAME_PATTERN,
    MAX_OWNER_LENGTH,
    MAX_REPO_NAME_LENGTH,
    MAX_REPOS_PER_PAGE,
)
from services.github import (
    GitHubService,
    GitHubAPIError,
    GitHubNotFoundError,
)
from services.rate_limiter import fetch_repo_with_retry
from services.queries import build_signal_map, build_snapshot_map
from services.snapshot import create_or_update_snapshot, update_repo_from_github
from routers.dependencies import get_repo_or_404

import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["repos"])


def _validate_github_identifier(owner: str, name: str) -> None:
    """
    驗證 GitHub owner 與 repo 名稱以防止 SSRF 攻擊。
    驗證失敗時拋出 HTTPException。
    """
    # 檢查長度
    if len(owner) > MAX_OWNER_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Owner name too long (max {MAX_OWNER_LENGTH} characters)"
        )
    if len(name) > MAX_REPO_NAME_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Repository name too long (max {MAX_REPO_NAME_LENGTH} characters)"
        )

    # 驗證 owner 格式（GitHub 使用者名稱模式）
    if not re.match(GITHUB_USERNAME_PATTERN, owner):
        raise HTTPException(
            status_code=400,
            detail="Invalid GitHub username format"
        )

    # 驗證 repo 名稱格式
    if not re.match(GITHUB_REPO_NAME_PATTERN, name):
        raise HTTPException(
            status_code=400,
            detail="Invalid repository name format"
        )


def _build_repo_with_signals(
    repo: Repo,
    snapshot: Optional[RepoSnapshot],
    signals: Dict[str, float | int]
) -> RepoWithSignals:
    """從預先抓取的資料建立 RepoWithSignals 回應。"""
    return RepoWithSignals(
        id=repo.id,
        owner=repo.owner,
        name=repo.name,
        full_name=repo.full_name,
        url=repo.url,
        description=repo.description,
        language=repo.language,
        added_at=repo.added_at,
        updated_at=repo.updated_at,
        stars=snapshot.stars if snapshot else None,
        forks=snapshot.forks if snapshot else None,
        stars_delta_7d=signals.get(SignalType.STARS_DELTA_7D),
        stars_delta_30d=signals.get(SignalType.STARS_DELTA_30D),
        velocity=signals.get(SignalType.VELOCITY),
        acceleration=signals.get(SignalType.ACCELERATION),
        trend=int(signals.get(SignalType.TREND, 0)) if SignalType.TREND in signals else None,
        last_fetched=snapshot.fetched_at if snapshot else None,
    )


def get_repo_with_signals(repo: Repo, db: Session) -> RepoWithSignals:
    """
    從 Repo model 建立 RepoWithSignals 回應。
    用於單一 repo 查詢 — 使用個別查詢。
    """
    snapshot_map = build_snapshot_map(db, [repo.id])
    signal_map = build_signal_map(db, [repo.id])

    return _build_repo_with_signals(
        repo,
        snapshot_map.get(repo.id),
        signal_map.get(repo.id, {})
    )




def _build_repo_list_response(
    db: Session,
    page: Optional[int] = None,
    per_page: Optional[int] = None,
) -> RepoListResponse:
    """建立含所有 repo 及其訊號的 RepoListResponse。支援可選分頁。"""
    query = db.query(Repo).order_by(desc(Repo.added_at))
    total = query.count()

    if total == 0:
        return RepoListResponse(repos=[], total=0)

    # 套用分頁（未提供時返回全部，與舊行為一致）
    if page is not None and per_page is not None:
        offset = (page - 1) * per_page
        # noinspection PyTypeChecker
        repos: List[Repo] = query.offset(offset).limit(per_page).all()
        total_pages = (total + per_page - 1) // per_page
    else:
        # noinspection PyTypeChecker
        repos = query.all()
        total_pages = None

    # noinspection PyTypeChecker
    repo_ids: List[int] = [r.id for r in repos]
    snapshot_map = build_snapshot_map(db, repo_ids)
    signal_map = build_signal_map(db, repo_ids)

    # noinspection PyTypeChecker
    repos_with_signals = [
        _build_repo_with_signals(
            repo,
            snapshot_map.get(repo.id),
            signal_map.get(repo.id, {})
        )
        for repo in repos
    ]

    return RepoListResponse(
        repos=repos_with_signals,
        total=total,
        page=page,
        per_page=per_page,
        total_pages=total_pages,
    )


@router.get("/repos", response_model=RepoListResponse)
async def list_repos(
    page: Optional[int] = Query(None, ge=1, description="Page number (omit for all results)"),
    per_page: Optional[int] = Query(None, ge=1, le=MAX_REPOS_PER_PAGE, description="Items per page"),
    db: Session = Depends(get_db),
) -> RepoListResponse:
    """
    列出追蹤清單中的所有 repo 及其最新訊號。
    使用批次查詢避免 N+1 問題。
    可選分頁：提供 page + per_page 啟用。
    """
    if (page is None) != (per_page is None):
        raise HTTPException(
            status_code=400,
            detail="Both 'page' and 'per_page' must be provided together for pagination",
        )
    return _build_repo_list_response(db, page=page, per_page=per_page)


@router.post("/repos", response_model=RepoWithSignals, status_code=status.HTTP_201_CREATED)
async def add_repo(repo_input: RepoCreate, db: Session = Depends(get_db)) -> RepoWithSignals:
    """
    將新 repo 加入追蹤清單。
    可提供 owner+name 或 GitHub URL。
    """
    try:
        owner, name = repo_input.get_owner_name()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # 驗證輸入以防止 SSRF
    _validate_github_identifier(owner, name)

    full_name = f"{owner}/{name}"

    # 檢查是否已存在
    existing = db.query(Repo).filter(Repo.full_name == full_name).first()
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Repository {full_name} is already in your watchlist"
        )

    # 從 GitHub 抓取 repo 資訊
    # GitHub 例外由 main.py 中的全域例外處理器處理。
    github = GitHubService()
    github_data = await github.get_repo(owner, name)

    # 建立 repo 紀錄
    repo = Repo(
        owner=owner,
        name=name,
        full_name=full_name,
        url=f"https://github.com/{full_name}",
        description=github_data.get("description"),
        github_id=github_data.get("id"),
        default_branch=github_data.get("default_branch"),
        language=github_data.get("language"),
        created_at=datetime.fromisoformat(github_data["created_at"].replace("Z", "+00:00")) if github_data.get("created_at") else None,
    )
    db.add(repo)
    db.flush()
    db.refresh(repo)

    # 建立初始快照（使用共用服務確保欄位映射一致）
    create_or_update_snapshot(repo, github_data, db)
    db.commit()

    return get_repo_with_signals(repo, db)


@router.get("/repos/{repo_id}", response_model=RepoWithSignals)
async def get_repo(repo_id: int, db: Session = Depends(get_db)) -> RepoWithSignals:
    """
    依 ID 取得單一 repo 及其訊號。
    """
    repo = get_repo_or_404(repo_id, db)
    return get_repo_with_signals(repo, db)


@router.delete("/repos/{repo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_repo(repo_id: int, db: Session = Depends(get_db)):
    """
    從追蹤清單移除 repo。
    同時刪除所有關聯的快照與訊號。
    """
    repo = get_repo_or_404(repo_id, db)
    db.delete(repo)
    db.commit()
    return None


@router.post("/repos/{repo_id}/fetch", response_model=RepoWithSignals)
async def fetch_repo(repo_id: int, db: Session = Depends(get_db)) -> RepoWithSignals:
    """
    手動抓取 repo 的最新資料。
    建立新快照並重新計算訊號。
    """
    repo = get_repo_or_404(repo_id, db)

    # 從 GitHub 抓取（例外由 main.py 全域處理器處理）
    github = GitHubService()
    github_data = await github.get_repo(repo.owner, repo.name)

    # 原子性更新中繼資料 + 快照 + 訊號
    update_repo_from_github(repo, github_data, db)

    return get_repo_with_signals(repo, db)


@router.post("/repos/fetch-all", response_model=RepoListResponse)
@limiter.limit("5/minute")
async def fetch_all_repos(request: Request, db: Session = Depends(get_db)) -> RepoListResponse:
    """
    抓取追蹤清單中所有 repo 的最新資料。
    使用指數退避重試處理速率限制。
    """
    _ = request  # 由 @limiter.limit decorator 隱式使用
    # noinspection PyTypeChecker
    repos: List[Repo] = db.query(Repo).all()
    github = GitHubService()

    for repo in repos:
        try:
            # 使用帶指數退避的重試包裝器
            github_data = await fetch_repo_with_retry(github, repo.owner, repo.name)

            # 原子性更新中繼資料 + 快照 + 訊號（每個 repo 獨立 commit）
            update_repo_from_github(repo, github_data, db)

        except GitHubNotFoundError:
            db.rollback()
            full_name = repo.full_name  # type: ignore[assignment]
            logger.warning(f"[Repo] {full_name} 在 GitHub 上找不到，跳過")
            continue
        except GitHubAPIError as e:
            db.rollback()
            full_name = repo.full_name  # type: ignore[assignment]
            logger.error(f"[Repo] {full_name} 重試後仍發生 GitHub API 錯誤: {e}", exc_info=True)
            continue

    return _build_repo_list_response(db)
