"""
追蹤清單 API 端點，管理 GitHub repo。
"""

import json
import logging
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import desc
from sqlalchemy.orm import Session

from constants import (
    SignalType,
    GITHUB_USERNAME_PATTERN,
    GITHUB_REPO_NAME_PATTERN,
    MAX_OWNER_LENGTH,
    MAX_REPO_NAME_LENGTH,
    MAX_REPOS_PER_PAGE,
)
from dataclasses import asdict

from db import get_db, Repo, RepoSnapshot
from db.soft_delete import include_archived
from middleware.rate_limit import limiter
from routers.dependencies import get_repo_or_404
from schemas import (
    RepoCreate,
    RepoWithSignals,
    RepoListResponse,
    BatchRepoCreate,
    BatchImportResult,
)
from schemas.response import ApiResponse, success_response
from services.github import (
    GitHubService,
    GitHubAPIError,
    GitHubNotFoundError,
    get_github_service,
)
from services.queries import build_signal_map, build_snapshot_map
from services.rate_limiter import fetch_repo_with_retry
from services.settings import get_setting
from services.star_sync import sync_starred_repos
from utils.time import utc_now
from db.models import AppSettingKey
from services.snapshot import create_or_update_snapshot, update_repo_from_github

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


def _create_repo_from_github(owner: str, name: str, github_data: dict) -> Repo:
    """從 GitHub API 回傳資料建立 Repo ORM 物件。"""
    full_name = f"{owner}/{name}"
    return Repo(
        owner=owner,
        name=name,
        full_name=full_name,
        url=f"https://github.com/{full_name}",
        description=github_data.get("description"),
        github_id=github_data.get("id"),
        default_branch=github_data.get("default_branch"),
        language=github_data.get("language"),
        topics=json.dumps(github_data.get("topics", [])) if github_data.get("topics") else None,
        created_at=datetime.fromisoformat(github_data["created_at"].replace("Z", "+00:00")) if github_data.get("created_at") else None,
    )


def _build_repo_with_signals(
    repo: Repo,
    snapshot: RepoSnapshot | None,
    signals: dict[str, float | int]
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
        forks_delta_7d=signals.get(SignalType.FORKS_DELTA_7D),
        forks_delta_30d=signals.get(SignalType.FORKS_DELTA_30D),
        issues_delta_7d=signals.get(SignalType.ISSUES_DELTA_7D),
        issues_delta_30d=signals.get(SignalType.ISSUES_DELTA_30D),
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
    page: int | None = None,
    per_page: int | None = None,
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
        repos: list[Repo] = query.offset(offset).limit(per_page).all()
        total_pages = (total + per_page - 1) // per_page
    else:
        # noinspection PyTypeChecker
        repos = query.all()
        total_pages = None

    # noinspection PyTypeChecker
    repo_ids: list[int] = [r.id for r in repos]
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


@router.get("/repos", response_model=ApiResponse[RepoListResponse])
async def list_repos(
    page: int | None = Query(None, ge=1, description="Page number (omit for all results)"),
    per_page: int | None = Query(None, ge=1, le=MAX_REPOS_PER_PAGE, description="Items per page"),
    db: Session = Depends(get_db),
) -> dict:
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

    repo_list = _build_repo_list_response(db, page=page, per_page=per_page)

    return success_response(
        data=repo_list,
        message=None
    )


@router.post("/repos", response_model=ApiResponse[RepoWithSignals], status_code=status.HTTP_201_CREATED)
async def add_repo(repo_input: RepoCreate, db: Session = Depends(get_db)) -> dict:
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

    # 檢查是否已存在。必須看得到封存的列：full_name 是唯一鍵，看不到就會一路往下
    # 打 GitHub 再 INSERT 撞鍵回 500
    existing = include_archived(
        db.query(Repo)).filter(Repo.full_name == full_name).first()
    if existing is not None and existing.unstarred_at is not None:
        # 封存的列＝使用者取消過又反悔。重新 star 並復原，而不是回 400——那會說
        # 「已經在清單裡」，但畫面上根本沒有它，使用者被永久擋住。
        github = get_github_service()
        if github.can_write:
            await github.star_repo(owner, name)
        existing.unstarred_at = None
        db.commit()
        db.refresh(existing)
        return success_response(
            data=get_repo_with_signals(existing, db),
            message=f"Repository {full_name} restored to watchlist",
        )
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Repository {full_name} is already in your watchlist"
        )

    # 從 GitHub 抓取 repo 資訊
    # GitHub 例外由 main.py 中的全域例外處理器處理。
    github = get_github_service()

    # 先寫 GitHub 再建本機列。反向順序會在寫入失敗時留下本機有、遠端沒有的狀態，
    # 而下一次同步會把它判成「使用者取消了 star」而封存——加進去的東西自己消失。
    #
    # 沒有 token 時只建本機列：star 寫入需要認證，但讀取可以匿名。這不會造成漂移，
    # 因為同步在沒有 token 時同樣不執行；等到日後連結帳號，那一次就是「首次同步」，
    # 而首次同步不自動封存，會把這些列出來讓使用者決定。
    if github.can_write:
        await github.star_repo(owner, name)

    github_data = await github.get_repo(owner, name)

    # 建立 repo 紀錄
    repo = _create_repo_from_github(owner, name, github_data)
    db.add(repo)
    db.flush()
    db.refresh(repo)

    # 建立初始快照（使用共用服務確保欄位映射一致）
    create_or_update_snapshot(repo, github_data, db)
    db.commit()

    repo_with_signals = get_repo_with_signals(repo, db)
    return success_response(
        data=repo_with_signals,
        message=f"Repository {repo.full_name} added to watchlist"
    )


@router.post("/repos/fetch-all", response_model=ApiResponse[RepoListResponse])
@limiter.limit("5/minute")
async def fetch_all_repos(request: Request, db: Session = Depends(get_db)) -> dict:
    """
    抓取追蹤清單中所有 repo 的最新資料。
    使用指數退避重試處理速率限制。
    與 scheduler 共享 _fetch_all_lock 防止並發全量抓取。
    """
    _ = request  # 由 @limiter.limit decorator 隱式使用

    from services.scheduler import _fetch_all_lock

    if _fetch_all_lock.locked():
        return success_response(data=_build_repo_list_response(db), message="Fetch already in progress")

    async with _fetch_all_lock:
        # noinspection PyTypeChecker
        repos: list[Repo] = db.query(Repo).all()
        github = get_github_service()

        success_count = 0
        failed_count = 0

        for repo in repos:
            try:
                github_data = await fetch_repo_with_retry(github, repo.owner, repo.name)
                update_repo_from_github(repo, github_data, db)
                success_count += 1
            except GitHubNotFoundError:
                db.rollback()
                logger.warning(f"[Repo] {repo.full_name} 在 GitHub 上找不到，跳過")
                failed_count += 1
            except GitHubAPIError as e:
                db.rollback()
                logger.error(f"[Repo] {repo.full_name} 重試後仍發生 GitHub API 錯誤: {e}", exc_info=True)
                failed_count += 1

        repo_list = _build_repo_list_response(db)
        return success_response(
            data=repo_list,
            message=f"Refreshed {success_count} repositories" + (f", {failed_count} failed" if failed_count > 0 else "")
        )


@router.post("/repos/batch", response_model=ApiResponse[BatchImportResult])
@limiter.limit("5/minute")
async def batch_add_repos(
    batch: BatchRepoCreate,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    """
    批次將多個 repo 加入追蹤清單。
    已存在的 repo 會被跳過，失敗的不會中斷整個批次。
    """
    _ = request  # 由 @limiter.limit decorator 隱式使用
    github = get_github_service()

    success = 0
    skipped = 0
    failed = 0
    errors: list[str] = []

    for repo_input in batch.repos:
        try:
            owner, name = repo_input.get_owner_name()
        except ValueError as e:
            failed += 1
            errors.append(f"無效的 repo 輸入: {e}")
            continue

        full_name = f"{owner}/{name}"

        try:
            _validate_github_identifier(owner, name)
        except HTTPException as e:
            failed += 1
            errors.append(f"{full_name}: {e.detail}")
            continue

        # 同上：必須看得到封存的列，否則會撞 full_name 唯一鍵
        existing = include_archived(
            db.query(Repo)).filter(Repo.full_name == full_name).first()
        if existing:
            skipped += 1
            continue

        try:
            # 同 add_repo：先 star 才建列（無 token 時略過，理由見該處）
            if github.can_write:
                await github.star_repo(owner, name)

            # 從 GitHub 抓取 repo 資訊
            github_data = await github.get_repo(owner, name)

            # 建立 repo 紀錄
            repo = _create_repo_from_github(owner, name, github_data)
            db.add(repo)
            db.flush()
            db.refresh(repo)

            # 建立初始快照
            create_or_update_snapshot(repo, github_data, db)
            db.commit()
            success += 1

        except GitHubNotFoundError:
            failed += 1
            errors.append(f"{full_name}: 在 GitHub 上找不到")
            db.rollback()
            continue
        except GitHubAPIError as e:
            failed += 1
            errors.append(f"{full_name}: GitHub API 錯誤 - {e}")
            db.rollback()
            continue
        except Exception as e:
            failed += 1
            errors.append(f"{full_name}: 未預期錯誤 - {e}")
            db.rollback()
            continue

    return success_response(
        data=BatchImportResult(
            total=len(batch.repos),
            success=success,
            skipped=skipped,
            failed=failed,
            errors=errors,
        ),
    )


# --- 帶路徑參數的路由放在最後，避免覆蓋固定路徑 ---


@router.get("/repos/archived", response_model=ApiResponse[RepoListResponse])
def list_archived(db: Session = Depends(get_db)) -> dict:
    """已取消 star 但資料仍保留的 repo。

    必須宣告在 /repos/{repo_id} 之前：FastAPI 依宣告順序比對，
    排在後面的話 "archived" 會被當成 repo_id 解析而回 422。
    """
    rows = (include_archived(db.query(Repo))
            .filter(Repo.unstarred_at.isnot(None))
            .order_by(desc(Repo.unstarred_at)).all())
    return success_response(RepoListResponse(
        repos=[get_repo_with_signals(r, db) for r in rows], total=len(rows)))


@router.get("/repos/{repo_id}", response_model=ApiResponse[RepoWithSignals])
async def get_repo(repo_id: int, db: Session = Depends(get_db)) -> dict:
    """
    依 ID 取得單一 repo 及其訊號。
    """
    repo = get_repo_or_404(repo_id, db)
    repo_with_signals = get_repo_with_signals(repo, db)
    return success_response(data=repo_with_signals)


@router.post("/repos/{repo_id}/unstar", response_model=ApiResponse[dict])
async def unstar_repo_endpoint(repo_id: int, db: Session = Depends(get_db)) -> dict:
    """取消追蹤：在 GitHub 取消 star，本機封存。不刪任何資料。

    先寫 GitHub 才改本機，理由同 add_repo：反向順序會在遠端失敗時讓本機與 GitHub
    不一致，而且沒有任何跡象。
    """
    repo = get_repo_or_404(repo_id, db)
    github = get_github_service()
    # 無 token 時只改本機，理由同 add_repo：寫入需要認證，而同步在無 token 時
    # 同樣不執行，所以不會產生漂移
    if github.can_write:
        await github.unstar_repo(repo.owner, repo.name)
    repo.unstarred_at = utc_now()
    db.commit()
    return success_response({"archived": repo_id})


@router.post("/repos/{repo_id}/restar", response_model=ApiResponse[dict])
async def restar_repo(repo_id: int, db: Session = Depends(get_db)) -> dict:
    """從封存清單復原：重新 star 並清除封存標記。快照與訊號原本就還在。"""
    repo = get_repo_or_404(repo_id, db, allow_archived=True)
    github = get_github_service()
    if github.can_write:
        await github.star_repo(repo.owner, repo.name)
    repo.unstarred_at = None
    db.commit()
    return success_response({"restored": repo_id})


@router.delete("/repos/{repo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_repo(repo_id: int, db: Session = Depends(get_db)) -> None:
    """永久刪除。

    連同快照、訊號、context signals、early signals 與**警示規則**一併 cascade
    刪除，不可復原。只接受已封存的 repo——取消追蹤請用 /unstar，那個保留資料。
    這道限制是為了讓不可逆的操作只能從封存清單發動，而不是追蹤清單上的一次誤點。
    """
    repo = get_repo_or_404(repo_id, db, allow_archived=True)
    if repo.unstarred_at is None:
        raise HTTPException(
            status_code=400,
            detail="Repository is still tracked; unstar it before deleting")
    db.delete(repo)
    db.commit()
    return None


@router.post("/repos/{repo_id}/fetch", response_model=ApiResponse[RepoWithSignals])
async def fetch_repo(repo_id: int, db: Session = Depends(get_db)) -> dict:
    """
    手動抓取 repo 的最新資料。
    建立新快照並重新計算訊號。
    """
    repo = get_repo_or_404(repo_id, db)

    # 從 GitHub 抓取（例外由 main.py 全域處理器處理）
    github = get_github_service()
    github_data = await github.get_repo(repo.owner, repo.name)

    # 原子性更新中繼資料 + 快照 + 訊號
    update_repo_from_github(repo, github_data, db)

    repo_with_signals = get_repo_with_signals(repo, db)
    return success_response(
        data=repo_with_signals,
        message=f"Repository {repo.full_name} data refreshed"
    )


class SyncResultOut(BaseModel):
    added: int
    restored: int
    renamed: int
    archived: int
    skipped_reason: str | None
    # 首次同步時「本機有、GitHub 沒有」的清單，由使用者決定去留
    pending_local_only: list[str] = []


class ResolvePayload(BaseModel):
    action: Literal["star", "archive"]
    full_names: list[str]


class SyncStatusOut(BaseModel):
    last_sync_at: str | None
    running: bool


@router.post("/repos/sync", response_model=ApiResponse[SyncResultOut])
@limiter.limit("4/minute")
async def sync_stars(request: Request, db: Session = Depends(get_db)) -> dict:
    """把追蹤清單對齊 GitHub 的 star。

    限流理由：這支會逐頁拉取並可能建立上百列。連按不會更快，只會讓兩輪互相
    卡在並行鎖上。
    """
    _ = request  # 由 @limiter.limit decorator 隱式使用
    result = await sync_starred_repos(db, get_github_service())
    return success_response(SyncResultOut(**asdict(result)))


@router.get("/repos/sync/status", response_model=ApiResponse[SyncStatusOut])
def sync_status(db: Session = Depends(get_db)) -> dict:
    return success_response(SyncStatusOut(
        last_sync_at=get_setting(AppSettingKey.LAST_STAR_SYNC_AT, db),
        running=bool(get_setting(AppSettingKey.STAR_SYNC_RUNNING, db)),
    ))


@router.post("/repos/sync/resolve", response_model=ApiResponse[dict])
async def resolve_local_only(payload: ResolvePayload,
                             db: Session = Depends(get_db)) -> dict:
    """處理首次同步列出的「本機有、GitHub 沒有」的 repo。

    star：推上 GitHub，讓它進入鏡像。archive：接受它已經不在清單裡。
    兩者都由使用者明確選擇——首次同步刻意不自己決定。
    """
    github = get_github_service()
    handled = 0
    for full_name in payload.full_names:
        repo = include_archived(
            db.query(Repo)).filter(Repo.full_name == full_name).first()
        if repo is None:
            continue
        if payload.action == "star":
            # 先寫 GitHub 才算數，理由同 add_repo
            if github.can_write:
                await github.star_repo(repo.owner, repo.name)
            repo.unstarred_at = None
        else:
            repo.unstarred_at = utc_now()
        handled += 1
    db.commit()
    return success_response({"handled": handled})
