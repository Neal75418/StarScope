"""GitHub 新版本發布的抓取與儲存。

為什麼加這個來源：HN 一週只講得到 94 個追蹤中 repo 的 5 個，而且對名字是普通字的
專案（apereo/cas）永遠給不出正確結果。實測同一份清單近 7 天有 14 個發了新版本，
對應關係也毫無歧義——「發了 v0.5.2」是事實，不是「某篇文章提到這個字」。

存進 context_signals，沿用既有的儲存、清理與 badge，只是 signal_type 不同。
"""

import asyncio
import logging
import re
from datetime import datetime
from typing import Any, NamedTuple

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from constants import ContextSignalType, RELEASE_FETCH_INTERVAL_MINUTES, RELEASE_NOTE_TAGS
from db.models import AppSettingKey, ContextSignal, Repo
from services.github import GitHubAPIError, get_github_service
from services.settings import get_setting, set_setting
from utils.time import utc_now

logger = logging.getLogger(__name__)

# 與抓取 repo 資料同一個值。請求總數不變，要避開的是 GitHub 對短時間大量並行的
# secondary rate limit
RELEASE_FETCH_CONCURRENCY = 5


def tag_release_notes(body: str | None) -> str | None:
    """從 release notes 掃出值得先看的標記，回傳逗號分隔字串或 None。

    只掃關鍵字、不存全文：我們要的是「值不值得先點進去」這個判斷，而 notes 全文
    會讓 context_signals 在 90 天保留期內長得很快。
    """
    if not body:
        return None
    lowered = body.lower()
    found = [
        tag
        for tag, needles in RELEASE_NOTE_TAGS.items()
        if any(n in lowered for n in needles)
    ]
    return ",".join(sorted(found)) or None


def _parse_published_at(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except (ValueError, AttributeError):
        return None


def _same_version(a: str, b: str) -> bool:
    """去掉大小寫與非英數字元後是否相同。

    tag 與 release 名稱常常是同一個版本號的兩種寫法：jax-v0.11.1 / JAX v0.11.1、
    jsoup-1.23.1 / jsoup 1.23.1。字面比對看不出來，接起來就變成重複的標題。
    """
    norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())
    return bool(norm(a)) and norm(a) == norm(b)


def _build_title(release: dict[str, Any]) -> str:
    """組出一行看得懂的版本標題。

    tag 與 name 的關係沒有規律：有的專案 name 留空，有的填得跟 tag 一模一樣，
    有的把 tag 包在 name 裡再加說明。實測出來的三種寫法：
        v0.19.1        / (空)                              -> v0.19.1
        v1.9.0         / "v1.9.0 - Command Code"           -> v1.9.0 - Command Code
        v8.0.0         / "8.0.0"                           -> v8.0.0
        release-29.0.2 / "Manticore Search 29.0.2"         -> release-29.0.2 Manticore Search 29.0.2
    只有最後一種需要兩個都留：其餘的其中一邊已經完整包含另一邊，硬接起來會變成
    「v1.9.0 v1.9.0 - ...」或「v8.0.0 8.0.0」。
    """
    tag = (release.get("tag_name") or "").strip()
    name = (release.get("name") or "").strip()
    if not name:
        return tag or "release"
    if not tag:
        return name
    # 正規化後再比：實測 jax-v0.11.1 與「JAX v0.11.1」是同一個版本號，
    # 但區分大小寫的子字串比對看不出來，於是接成「jax-v0.11.1 JAX v0.11.1」。
    # 81 個版本裡有 5 個是這種寫法。相同時留 name，它是給人看的那一個。
    if _same_version(tag, name):
        return name
    if tag in name:
        return name
    if name in tag:
        return tag
    return f"{tag} {name}"


class _ReleaseTarget(NamedTuple):
    """併發抓取時帶的純值。

    coroutine 裡不碰 ORM 物件：Session 既非 thread-safe 也非 coroutine-safe，
    而且 commit 後屬性會過期，之後每次讀取都會回頭打一次 DB。
    """
    repo_id: int
    owner: str
    name: str
    full_name: str


def store_release(target: _ReleaseTarget, release: dict[str, Any], db: Session) -> bool:
    """寫入或更新一筆 release 訊號，回傳是否為新增。

    以 release id 當 external_id：tag 名稱可以被刪掉重推同名的，id 不會。
    """
    external_id = str(release.get("id") or release.get("tag_name") or "")
    if not external_id:
        return False

    # 查詢只為了回傳「是否新增」；寫入改原子 upsert 以防跨行程撞
    # uq_context_signal_unique（App 與無頭收集器同時掃版本）。
    is_new = (
        db.query(ContextSignal.id)
        .filter(
            ContextSignal.repo_id == target.repo_id,
            ContextSignal.signal_type == ContextSignalType.RELEASE,
            ContextSignal.external_id == external_id,
        )
        .first()
    ) is None

    title = _build_title(release)
    tags = tag_release_notes(release.get("body"))

    stmt = sqlite_insert(ContextSignal).values(
        repo_id=target.repo_id,
        signal_type=ContextSignalType.RELEASE,
        external_id=external_id,
        title=title,
        url=release.get("html_url") or f"https://github.com/{target.full_name}/releases",
        author=(release.get("author") or {}).get("login"),
        published_at=_parse_published_at(release.get("published_at")),
        tags=tags,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["repo_id", "signal_type", "external_id"],
        set_={
            # 已發布的版本仍可能被編輯 notes：只重掃標題與標記，不動發布時間與作者
            "title": stmt.excluded.title,
            "tags": stmt.excluded.tags,
            "fetched_at": utc_now(),
        },
    )
    db.execute(stmt)
    return is_new


def fetched_recently(db: Session, within_minutes: int = RELEASE_FETCH_INTERVAL_MINUTES) -> bool:
    """距上次抓取是否還在間隔內。

    這個 app 每次開啟都會觸發一次抓取，否則 3 小時的排程在「開一小時就關掉」
    的使用方式下可能一次都跑不到。但反覆開關就不該每次都重掃 94 個 repo，
    所以記一個時間戳來擋。時間戳解析失敗一律當成「該抓了」——寧可多抓一次，
    也不要因為一個壞掉的字串讓這個功能永遠靜默。
    """
    raw = get_setting(AppSettingKey.LAST_RELEASE_FETCH_AT, db)
    if not raw:
        return False
    try:
        last = datetime.fromisoformat(raw)
    except (ValueError, TypeError):
        logger.warning(f"[版本] 無法解析上次抓取時間 {raw!r}，視為需要重抓")
        return False
    return (utc_now() - last).total_seconds() < within_minutes * 60


async def fetch_all_releases(db: Session) -> dict[str, int]:
    """為追蹤清單中所有 repo 抓取最新版本。

    網路併發、DB 寫入序列：先把所有 repo 的查詢跑完，再依序寫入。
    寫入不能一起併發，理由見 _ReleaseTarget。
    """
    # noinspection PyTypeChecker
    repos: list[Repo] = db.query(Repo).all()
    targets = [
        _ReleaseTarget(int(r.id), str(r.owner), str(r.name), str(r.full_name))
        for r in repos
    ]

    gh = get_github_service()
    sem = asyncio.Semaphore(RELEASE_FETCH_CONCURRENCY)

    async def _fetch_one(
        target: _ReleaseTarget,
    ) -> tuple[_ReleaseTarget, dict[str, Any] | None, Exception | None]:
        async with sem:
            try:
                return target, await gh.get_latest_release(target.owner, target.name), None
            except GitHubAPIError as e:
                return target, None, e
            except Exception as e:  # 安全網：單一 repo 失敗不中斷整個 batch
                return target, None, e

    fetched = await asyncio.gather(*(_fetch_one(t) for t in targets))

    new_count = 0
    without_releases = 0
    errors = 0

    for target, release, error in fetched:
        if error is not None:
            errors += 1
            logger.error(
                f"[版本] 抓取 {target.full_name} 最新版本失敗: {error}", exc_info=error
            )
            continue
        if release is None:
            without_releases += 1
            continue
        try:
            if store_release(target, release, db):
                new_count += 1
            db.commit()
        except SQLAlchemyError as e:
            db.rollback()
            errors += 1
            logger.error(f"[版本] {target.full_name} 版本訊號儲存失敗: {e}", exc_info=True)

    set_setting(AppSettingKey.LAST_RELEASE_FETCH_AT, utc_now().isoformat(), db)

    return {
        "repos_processed": len(repos),
        "new_releases": new_count,
        "repos_without_releases": without_releases,
        "errors": errors,
    }
