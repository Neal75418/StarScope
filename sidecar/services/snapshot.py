"""
共用快照服務，負責建立/更新 repo 快照。
消除 routers/repos.py 與 services/scheduler.py 間的重複，
並封裝完整的 repo 更新流程（中繼資料 + 快照 + 訊號 + commit），
以防止時序耦合問題。
"""

import logging

from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from db.models import Repo, RepoSnapshot
from services.analyzer import calculate_signals
from utils.time import utc_now, utc_today

logger = logging.getLogger(__name__)


# GitHub API 中真正的 watcher 欄位（訂閱通知的使用者）。
# 注意：`watchers_count` 是等同於 `stargazers_count` 的舊欄位。
_WATCHERS_FIELD = "subscribers_count"


def create_or_update_snapshot(repo: Repo, github_data: dict, db: Session) -> None:
    """建立或更新 repo 的今日快照（原子 upsert）。

    使用 `subscribers_count` 作為 watcher 數
    （GitHub API 中訂閱通知者的正確欄位）。

    必須是 INSERT ... ON CONFLICT 而不是先查後寫：App 與 launchd 無頭收集器是
    兩個行程，登入時（App 自啟 + RunAtLoad）會在同一分鐘內各自抓同一批 repo，
    check-then-act 會讓後 commit 的一方撞 uq_snapshot_repo_date，該 repo 整輪
    更新被 rollback 沖銷。隔壁 analyzer.calculate_signals 的同款 race 已用
    upsert 修過，這裡是漏掉的 sibling（第三方審查發現）。

    附帶的刻意行為：SessionLocal 是 autoflush=False，舊的 ORM add() 寫法讓
    「當天首次抓取」的快照在同一 transaction 內的 calculate_signals 看不到
    （尚未 flush），每天第一輪的 stars_delta_1d 都被吞成 None。core upsert
    立即落 DB，同 transaction 的 SELECT 查得到。若改回 ORM 寫法會靜默退化，
    有測試釘住。
    """
    stmt = sqlite_insert(RepoSnapshot).values(
        repo_id=repo.id,
        stars=github_data.get("stargazers_count", 0),
        forks=github_data.get("forks_count", 0),
        watchers=github_data.get(_WATCHERS_FIELD, 0),
        open_issues=github_data.get("open_issues_count", 0),
        snapshot_date=utc_today(),
        fetched_at=utc_now(),
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["repo_id", "snapshot_date"],
        set_={
            "stars": stmt.excluded.stars,
            "forks": stmt.excluded.forks,
            "watchers": stmt.excluded.watchers,
            "open_issues": stmt.excluded.open_issues,
            "fetched_at": stmt.excluded.fetched_at,
        },
    )
    db.execute(stmt)


def update_repo_from_github(repo: Repo, github_data: dict, db: Session) -> None:
    """
    原子性更新 repo 中繼資料、快照及訊號。

    封裝完整更新流程以防止時序耦合 —
    呼叫者無需記住正確的操作順序。
    """
    # 0. 驗證身分。抓取是用 owner/name 查的，而名稱不是穩定的識別碼——repo 會改名，
    #    舊名字可能被別人佔走。那時 GitHub 回的是 200（別人的 repo，沒有導向），
    #    照單全收就會把別人的星數與描述寫進你的列，而且完全無聲。
    incoming_id = github_data.get("id")
    if repo.github_id is not None and incoming_id is not None and incoming_id != repo.github_id:
        logger.warning(
            f"[Repo] {repo.full_name} 查到的是不同的 repo"
            f"（本機 id={repo.github_id}、回應 id={incoming_id}），略過本次更新")
        return

    # 1. 更新中繼資料
    repo.description = github_data.get("description")
    repo.language = github_data.get("language")
    # id 相同就是同一個 repo，改名要跟著更新——否則下次還是拿舊名去查，
    # 一直依賴導向，而舊名總有一天會被佔走
    incoming_full_name = github_data.get("full_name")
    if incoming_full_name and incoming_full_name != repo.full_name:
        logger.info(f"[Repo] {repo.full_name} 已更名為 {incoming_full_name}")
        repo.full_name = incoming_full_name
        repo.owner = (github_data.get("owner") or {}).get("login") or repo.owner
        repo.name = github_data.get("name") or repo.name
    repo.updated_at = utc_now()

    # 2. 建立或更新快照
    create_or_update_snapshot(repo, github_data, db)

    # 3. 重新計算訊號
    calculate_signals(repo.id, db)

    # 4. 原子性提交所有變更
    db.commit()
