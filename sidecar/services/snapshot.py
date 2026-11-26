"""
共用快照服務，負責建立/更新 repo 快照。
消除 routers/repos.py 與 services/scheduler.py 間的重複，
並封裝完整的 repo 更新流程（中繼資料 + 快照 + 訊號 + commit），
以防止時序耦合問題。
"""

import logging

from sqlalchemy import func
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from db.models import Repo, RepoSnapshot
from schemas.time import to_utc_iso
from services.analyzer import calculate_signals
from utils.time import utc_now, utc_today

logger = logging.getLogger(__name__)


# GitHub API 中真正的 watcher 欄位（訂閱通知的使用者）。
# 注意：`watchers_count` 是等同於 `stargazers_count` 的舊欄位。
_WATCHERS_FIELD = "subscribers_count"


def latest_snapshot_written_at(db: Session) -> str | None:
    """最新一筆快照的寫入時間（fetched_at 的最大值，帶時區的 ISO 字串）；還沒有快照時回 None。

    診斷頁的「最近快照」與同步狀態共用（前端靠後者發現背景抓取寫了新資料）。從資料庫取，
    背景收集器那個行程寫的也看得到。

    取 fetched_at（實際寫入時間）而非 snapshot_date：後者是 Date 欄位，序列化成「2026-08-29」後前端
    當午夜解析，顯示的其實是「距今天午夜多久」，整天增長、午夜歸零，當日停滯看不出來（實測過：畫面說
    「14h」，實際最後一次寫入是 30 分鐘前）。快照是 upsert，同一天重抓也會更新 fetched_at；回填新建的
    歷史日期快照帶的是「現在」的寫入時間，回填後算剛寫入——這裡回答的是「資料多久前寫入」，不是「最新快照是哪天」。

    必須帶時區：fetched_at 是 naive UTC，不帶 tzinfo 的字串會被 JS 當本地時間解析，UTC+8 之下算出
    負數年齡，formatRelativeTime 的 guard 讓它永遠顯示「剛剛」。
    """
    latest = db.query(func.max(RepoSnapshot.fetched_at)).scalar()
    return to_utc_iso(latest) if latest else None


def create_or_update_snapshot(repo: Repo, github_data: dict, db: Session) -> None:
    """建立或更新 repo 的今日快照（原子 upsert）。

    使用 `subscribers_count` 作為 watcher 數
    （GitHub API 中訂閱通知者的正確欄位）。

    必須是 INSERT ... ON CONFLICT 而不是先查後寫：App 與 launchd 無頭收集器是
    兩個行程，登入時（App 自啟 + RunAtLoad）會在同一分鐘內各自抓同一批 repo，
    check-then-act 會讓後 commit 的一方撞 uq_snapshot_repo_date，該 repo 整輪
    更新被 rollback 沖銷。analyzer.calculate_signals 有同款 race，也是用 upsert。

    附帶的刻意行為：SessionLocal 是 autoflush=False，用 ORM 的 add() 寫的話，
    「當天首次抓取」的快照在同一 transaction 內的 calculate_signals 看不到
    （尚未 flush），每天第一輪的 stars_delta_1d 都會被吞成 None。core upsert
    立即落 DB，同 transaction 的 SELECT 查得到；有測試釘住這件事。
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
    incoming_full_name: str = github_data.get("full_name") or repo.full_name
    if incoming_full_name != repo.full_name:
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
