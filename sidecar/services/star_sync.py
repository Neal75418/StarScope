"""追蹤清單與 GitHub star 的同步。

比對鍵是 github_id 而非 full_name：repo 在 GitHub 上改名時 full_name 會變、
github_id 不變，用 full_name 比對會把改名判成「舊的消失 + 新的出現」，於是封存舊列
並建立新列，歷史快照從此斷成兩截。
"""
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from db.models import AppSettingKey, Repo
from db.soft_delete import include_archived
from services.settings import get_setting, set_setting
from utils.time import utc_now

logger = logging.getLogger(__name__)

# 同步鎖的有效期。鎖存在 DB 而非記憶體，所以行程被殺（sidecar 是 Tauri 的子行程，
# app 關閉時會被殺）時 finally 不會執行，鎖就永遠留著——之後每次同步都回
# already_running 且無介面可解除。以「開始時間」記錄並設有效期，讓陳舊的鎖自動失效。
# 一次同步實際只需一到數次請求，十分鐘遠超過任何正常情況。
STALE_LOCK_MINUTES = 10


@dataclass
class RemoteStar:
    """GitHub 上的一個 star。payload 是原始的 repo 物件，用來建立本機列。"""
    github_id: int
    full_name: str
    owner: str
    name: str
    starred_at: datetime | None
    payload: dict


@dataclass
class SyncResult:
    added: int = 0
    restored: int = 0
    renamed: int = 0
    archived: int = 0
    skipped_reason: str | None = None
    # 首次同步時「本機有、GitHub 沒有」的 repo。不自動封存，交由使用者決定
    # 要推上去還是封存；其餘時候恆為空。
    pending_local_only: list[str] = field(default_factory=list)


@dataclass
class StarredFetch:
    """get_user_starred_with_dates 的回傳：清單本體＋是否被分頁上限截斷。"""
    stars: list[RemoteStar]
    truncated: bool = False


@dataclass
class SyncDiff:
    added: list[RemoteStar] = field(default_factory=list)
    restored: list[tuple[Repo, RemoteStar]] = field(default_factory=list)
    renamed: list[tuple[Repo, RemoteStar]] = field(default_factory=list)
    # star 日期需要補寫的：既不是新增也不是復原，只是本機的日期缺了或跟遠端不同。
    # 沒有這一項的話，同步前就存在的 repo 永遠拿不到 starred_at。
    restamped: list[tuple[Repo, RemoteStar]] = field(default_factory=list)
    archived: list[Repo] = field(default_factory=list)


def diff_starred(local: list[Repo], remote: list[RemoteStar]) -> SyncDiff:
    """算出本機要做哪些改動才會與遠端一致。不做任何寫入。

    local 必須包含已封存的列，否則重新 star 會被誤判成新增，而 full_name 是唯一鍵，
    新增會直接撞鍵。
    """
    by_id = {r.github_id: r for r in local if r.github_id is not None}
    diff = SyncDiff()
    seen: set[int] = set()

    for star in remote:
        seen.add(star.github_id)
        existing = by_id.get(star.github_id)
        if existing is None:
            diff.added.append(star)
            continue
        if existing.unstarred_at is not None:
            diff.restored.append((existing, star))
        elif existing.starred_at != star.starred_at:
            # 復原本來就會寫日期，所以只有「單純比對到」的才需要補
            diff.restamped.append((existing, star))
        if existing.full_name != star.full_name:
            diff.renamed.append((existing, star))

    for repo in local:
        # 沒有 github_id 就無從判斷遠端有沒有它，不能當成「已取消 star」
        if repo.github_id is None:
            continue
        if repo.github_id not in seen and repo.unstarred_at is None:
            diff.archived.append(repo)

    return diff


def _repo_from_star(star: RemoteStar) -> Repo:
    """直接用 starred 回應建列。

    不要再對每個 repo 呼叫一次 get_repo——首次同步有九十幾個，那是九十幾次額外
    請求，而且會和 main.py 啟動時已經觸發的 trigger_fetch_now() 撞在一起。
    """
    p = star.payload
    return Repo(
        owner=star.owner,
        name=star.name,
        full_name=star.full_name,
        url=p.get("html_url") or f"https://github.com/{star.full_name}",
        description=p.get("description"),
        github_id=star.github_id,
        default_branch=p.get("default_branch"),
        language=p.get("language"),
        topics=json.dumps(p.get("topics", [])) if p.get("topics") else None,
        starred_at=star.starred_at,
    )


def _lock_is_held(raw: str | None) -> bool:
    """鎖是否仍然有效。無法解析的值視為未上鎖——寧可多跑一輪，也不要永久卡死。"""
    if not raw:
        return False
    try:
        started = datetime.fromisoformat(raw)
    except ValueError:
        logger.warning(f"[Star 同步] 鎖的時間格式無法解析，視為未上鎖: {raw!r}")
        return False
    return (utc_now() - started) < timedelta(minutes=STALE_LOCK_MINUTES)


async def sync_starred_repos(db: Session, github: Any) -> SyncResult:
    """把本機追蹤清單對齊 GitHub 的 star。

    三道守則保護的都是同一件事：資訊不足時不執行移除。封存雖可復原，但一次誤封存
    整份清單仍是這個功能最貴的誤動作。
    """
    if not get_setting(AppSettingKey.GITHUB_TOKEN, db):
        return SyncResult(skipped_reason="no_token")

    if _lock_is_held(get_setting(AppSettingKey.STAR_SYNC_RUNNING, db)):
        return SyncResult(skipped_reason="already_running")

    set_setting(AppSettingKey.STAR_SYNC_RUNNING, utc_now().isoformat(), db)
    try:
        try:
            fetched = await github.get_user_starred_with_dates()
        except Exception as e:
            logger.warning(f"[Star 同步] 取得 starred 失敗，不執行任何移除: {e}")
            return SyncResult(skipped_reason="fetch_failed")

        remote, truncated = fetched.stars, fetched.truncated
        if not remote:
            logger.warning("[Star 同步] 回傳 0 筆，不執行任何移除")
            return SyncResult(skipped_reason="empty_response")

        # 必須含封存的：否則重新 star 會被判成新增而撞 full_name 唯一鍵
        local = include_archived(db.query(Repo)).all()
        diff = diff_starred(local, remote)

        # 改名先於新增，且中間 flush 一次：repo 改名後，它原本的名字可能被另一個
        # 你也 star 的 repo 佔走。先做新增就會在舊列還持有那個 full_name 時 INSERT，
        # 撞上唯一鍵讓整輪同步回滾。SQLAlchemy 目前的 flush 順序剛好正確，但正確性
        # 不該依賴我們沒有選擇的排序。
        for repo, star in diff.renamed:
            repo.full_name, repo.owner, repo.name = star.full_name, star.owner, star.name
        if diff.renamed:
            db.flush()

        for star in diff.added:
            db.add(_repo_from_star(star))
        for repo, star in diff.restored:
            repo.unstarred_at = None
            repo.starred_at = star.starred_at
        for repo, star in diff.restamped:
            repo.starred_at = star.starred_at
        # 首次同步的差異是歷史遺留，之後的差異才代表使用者取消了 star。
        # 用同一套邏輯處理會把歷史遺留當成使用者的決定。
        is_first_sync = get_setting(AppSettingKey.LAST_STAR_SYNC_AT, db) is None
        # 截斷＝資訊不足：清單缺的那截裡的 repo 會全數落進 diff.archived，
        # 但那是「沒看到」不是「已取消 star」。照模組守則：資訊不足時不執行移除。
        skip_removals = is_first_sync or truncated
        if truncated and diff.archived:
            logger.warning(
                f"[Star 同步] 清單被截斷，跳過 {len(diff.archived)} 筆移除（資訊不足）")
        pending: list[str] = []
        if is_first_sync and not truncated:
            # 截斷時 diff.archived 是「沒看到」不是「本機獨有」，
            # 放進 pending 會讓 UI 請使用者封存一批其實還 star 著的 repo
            pending = [r.full_name for r in diff.archived]
        elif not skip_removals:
            for repo in diff.archived:
                repo.unstarred_at = utc_now()

        try:
            db.commit()
        except IntegrityError as e:
            # 兩個行程（App 啟動＋launchd RunAtLoad）同時通過鎖檢查、同時新增
            # 同一個 repo 時撞唯一鍵。輸的一方放棄這輪即可——贏的那輪已寫入。
            db.rollback()
            if not diff.added:
                # commit 階段唯一會撞唯一鍵的是 added 的 INSERT。沒有新增卻出現
                # IntegrityError＝這批資料本身違反約束，吞成 race 會讓同步從此
                # 每輪都謊報「對方已完成」且 LAST_STAR_SYNC_AT 永不更新
                raise
            logger.warning(f"[Star 同步] 與另一行程的同步撞鍵，本輪放棄（對方已完成）：{e.orig}")
            return SyncResult(skipped_reason="race_lost")
        set_setting(AppSettingKey.LAST_STAR_SYNC_AT, utc_now().isoformat() + "Z", db)
        logger.info(
            f"[Star 同步] 新增 {len(diff.added)}、復原 {len(diff.restored)}、"
            f"改名 {len(diff.renamed)}、"
            f"封存 {0 if skip_removals else len(diff.archived)}"
            + (f"、待決定 {len(pending)}" if pending else ""))
        return SyncResult(added=len(diff.added), restored=len(diff.restored),
                          renamed=len(diff.renamed),
                          archived=0 if skip_removals else len(diff.archived),
                          pending_local_only=pending)
    finally:
        set_setting(AppSettingKey.STAR_SYNC_RUNNING, "", db)


def sync_is_running(db: Session) -> bool:
    """同步是否進行中——含 10 分鐘過期判斷。

    sync/status 端點先前用 bool(非空字串) 判斷，行程被殺後鎖殘留會讓它
    永遠回報「同步中」；這裡把 _lock_is_held 的同一套規則開放給查詢端。
    """
    return _lock_is_held(get_setting(AppSettingKey.STAR_SYNC_RUNNING, db))
