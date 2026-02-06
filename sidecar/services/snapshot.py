"""
共用快照服務，負責建立/更新 repo 快照。
消除 routers/repos.py 與 services/scheduler.py 間的重複，
並封裝完整的 repo 更新流程（中繼資料 + 快照 + 訊號 + commit），
以防止時序耦合問題。
"""

from typing import Dict

from sqlalchemy.orm import Session

from db.models import Repo, RepoSnapshot
from services.analyzer import calculate_signals
from utils.time import utc_now, utc_today


# GitHub API 中真正的 watcher 欄位（訂閱通知的使用者）。
# 注意：`watchers_count` 是等同於 `stargazers_count` 的舊欄位。
_WATCHERS_FIELD = "subscribers_count"


def create_or_update_snapshot(repo: Repo, github_data: Dict, db: Session) -> RepoSnapshot:
    """
    建立或更新 repo 的今日快照。

    使用 `subscribers_count` 作為 watcher 數
    （GitHub API 中訂閱通知者的正確欄位）。
    """
    today = utc_today()
    existing_snapshot = (
        db.query(RepoSnapshot)
        .filter(RepoSnapshot.repo_id == repo.id, RepoSnapshot.snapshot_date == today)
        .first()
    )

    if existing_snapshot:
        existing_snapshot.stars = github_data.get("stargazers_count", 0)
        existing_snapshot.forks = github_data.get("forks_count", 0)
        existing_snapshot.watchers = github_data.get(_WATCHERS_FIELD, 0)
        existing_snapshot.open_issues = github_data.get("open_issues_count", 0)
        existing_snapshot.fetched_at = utc_now()
        return existing_snapshot
    else:
        snapshot = RepoSnapshot(
            repo_id=repo.id,
            stars=github_data.get("stargazers_count", 0),
            forks=github_data.get("forks_count", 0),
            watchers=github_data.get(_WATCHERS_FIELD, 0),
            open_issues=github_data.get("open_issues_count", 0),
            snapshot_date=today,
            fetched_at=utc_now(),
        )
        db.add(snapshot)
        return snapshot


def update_repo_from_github(repo: Repo, github_data: Dict, db: Session) -> None:
    """
    原子性更新 repo 中繼資料、快照及訊號。

    封裝完整更新流程以防止時序耦合 —
    呼叫者無需記住正確的操作順序。
    """
    # 1. 更新中繼資料
    repo.description = github_data.get("description")
    repo.language = github_data.get("language")
    repo.updated_at = utc_now()

    # 2. 建立或更新快照
    create_or_update_snapshot(repo, github_data, db)

    # 3. 重新計算訊號
    calculate_signals(repo.id, db)

    # 4. 原子性提交所有變更
    db.commit()
