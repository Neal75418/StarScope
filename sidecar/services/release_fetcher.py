"""GitHub 新版本發布的抓取與儲存。

為什麼加這個來源：HN 一週只講得到 94 個追蹤中 repo 的 5 個，而且對名字是普通字的
專案（apereo/cas）永遠給不出正確結果。實測同一份清單近 7 天有 14 個發了新版本，
對應關係也毫無歧義——「發了 v0.5.2」是事實，不是「某篇文章提到這個字」。

存進 context_signals，沿用既有的儲存、清理與 badge，只是 signal_type 不同。
"""

import asyncio
import logging
from datetime import datetime
from typing import Any, NamedTuple

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from constants import ContextSignalType, RELEASE_NOTE_TAGS
from db.models import ContextSignal, Repo
from services.github import GitHubAPIError, get_github_service
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


def _build_title(release: dict[str, Any]) -> str:
    """組出一行看得懂的版本標題。

    tag 與 name 的關係沒有規律：有的專案 name 留空，有的填得跟 tag 一模一樣，
    有的把 tag 包在 name 裡再加說明。實測出來的三種寫法：
        v0.19.1        / (空)                              -> v0.19.1
        v1.9.0         / "v1.9.0 - Command Code"           -> v1.9.0 - Command Code
        release-29.0.2 / "Manticore Search 29.0.2"         -> release-29.0.2 Manticore Search 29.0.2
    只有第三種需要兩個都留——前兩種硬接起來會變成「v1.9.0 v1.9.0 - ...」。
    """
    tag = (release.get("tag_name") or "").strip()
    name = (release.get("name") or "").strip()
    if not name:
        return tag or "release"
    if not tag or tag in name:
        return name
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

    existing = (
        db.query(ContextSignal)
        .filter(
            ContextSignal.repo_id == target.repo_id,
            ContextSignal.signal_type == ContextSignalType.RELEASE,
            ContextSignal.external_id == external_id,
        )
        .first()
    )

    title = _build_title(release)
    tags = tag_release_notes(release.get("body"))

    if existing:
        # 已發布的版本仍可能被編輯 notes，重掃一次標記
        existing.title = title
        existing.tags = tags
        existing.fetched_at = utc_now()
        return False

    db.add(
        ContextSignal(
            repo_id=target.repo_id,
            signal_type=ContextSignalType.RELEASE,
            external_id=external_id,
            title=title,
            url=release.get("html_url") or f"https://github.com/{target.full_name}/releases",
            author=(release.get("author") or {}).get("login"),
            published_at=_parse_published_at(release.get("published_at")),
            tags=tags,
        )
    )
    return True


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

    return {
        "repos_processed": len(repos),
        "new_releases": new_count,
        "repos_without_releases": without_releases,
        "errors": errors,
    }
