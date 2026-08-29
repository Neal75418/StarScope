"""
情境訊號抓取服務。
僅從 Hacker News 抓取。
"""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any, NamedTuple

from sqlalchemy import func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from constants import CONTEXT_SIGNAL_MAX_AGE_DAYS, CONTEXT_SIGNAL_MAX_PER_REPO, ContextSignalType
from db.models import Repo, ContextSignal
from services.hacker_news import fetch_hn_mentions, is_relevant_story, HNStory
from utils.time import utc_now

logger = logging.getLogger(__name__)


def _get_existing_signal_map(
    repo_id: int,
    signal_type: str,
    external_ids: list[str],
    db: Session
) -> dict[str, "ContextSignal"]:
    """
    批次載入既有訊號以避免 N+1 查詢。

    Returns:
        external_id 對應 ContextSignal 物件的字典
    """
    if not external_ids:
        return {}

    existing = db.query(ContextSignal).filter(
        ContextSignal.repo_id == repo_id,
        ContextSignal.signal_type == signal_type,
        ContextSignal.external_id.in_(external_ids)
    ).all()

    # noinspection PyTypeChecker
    return {str(s.external_id): s for s in existing}


def _update_existing_signal(
    existing: "ContextSignal",
    score: int,
    comment_count: int
) -> None:
    """以新的 score 和留言數更新既有訊號。"""
    existing.score = score
    existing.comment_count = comment_count
    existing.fetched_at = utc_now()


def _store_hn_signals(repo_id: int, stories: list[HNStory], db: Session) -> int:
    """
    將 HN 文章儲存為情境訊號。

    Args:
        repo_id: repo ID
        stories: HNStory 物件列表
        db: 資料庫 session

    Returns:
        新增的訊號數量
    """
    if not stories:
        return 0

    # 批次載入既有訊號
    external_ids = [s.object_id for s in stories]
    existing_map = _get_existing_signal_map(
        repo_id, ContextSignalType.HACKER_NEWS, external_ids, db
    )

    # existing_map 只用來「計數新增」；寫入本身走原子 upsert——App 與無頭
    # 收集器是兩個行程，check-then-act 會撞 uq_context_signal_unique。
    # 極端同時下計數可能少 1（兩邊都以為對方已存在），錯的只是訊息裡的數字。
    count = 0
    for story in stories:
        if story.object_id not in existing_map:
            count += 1
        stmt = sqlite_insert(ContextSignal).values(
            repo_id=repo_id,
            signal_type=ContextSignalType.HACKER_NEWS,
            external_id=story.object_id,
            title=story.title,
            url=story.url,
            score=story.points,
            comment_count=story.num_comments,
            author=story.author,
            published_at=story.created_at,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["repo_id", "signal_type", "external_id"],
            set_={
                # 與 _update_existing_signal 相同的更新範圍：分數、留言數、抓取時間
                "score": stmt.excluded.score,
                "comment_count": stmt.excluded.comment_count,
                "fetched_at": utc_now(),
            },
        )
        db.execute(stmt)

    return count


def _store_and_commit(repo_id: int, stories: list[HNStory] | None, db: Session) -> int:
    """寫入抓到的 HN 文章並 commit。SQLAlchemyError 交由呼叫端處理。

    單一 repo 抓取與整批掃描共用這一段，兩條路徑才不會在儲存語意上分岔。
    """
    count = _store_hn_signals(repo_id, stories, db) if stories else 0
    db.commit()
    return count


class ContextFetchError(Exception):
    """單一 repo 的情境抓取失敗——手動端點要據此回錯誤而非「成功，0 個」。

    「HN 抓不到」「抓到存不進去」與「這個 repo 真的沒有 HN 討論」先前在
    API 契約上不可區分：三者都是 200 + hn_count=0。斷網期間反覆按
    「重新整理 context」永遠得到看似正常的 0（第三方審查發現）。
    整批掃描路徑不用這個例外——批次的單 repo 容錯屬於排程自己的語意。
    """


async def fetch_context_signals_for_repo(repo: "Repo", db: Session) -> int:
    """為單一 repo 抓取 HN 情境訊號。回傳新增筆數。

    Raises:
        ContextFetchError: HN API 失敗或 DB 儲存失敗（呼叫端須回報錯誤）。
    """
    hn_stories = await fetch_hn_mentions(repo.owner, repo.name)
    if hn_stories is None:
        raise ContextFetchError(f"{repo.full_name} 的 HN 查詢失敗")
    try:
        return _store_and_commit(int(repo.id), hn_stories, db)
    except SQLAlchemyError as e:
        db.rollback()
        logger.warning(f"[上下文] {repo.full_name} HN 訊號儲存失敗: {e}")
        raise ContextFetchError(f"{repo.full_name} 的訊號儲存失敗") from e


# 同時對 HN 發出的查詢數。整批掃描是 repo 數 × 2 次查詢，序列跑完 94 個 repo 實測
# 104 秒，共用連線 + 併發 5 降到 16 秒。不開更大：請求總數不變、再往上只換到個位數
# 秒差，卻讓 Algolia 更容易把這串請求當成突發流量。
CONTEXT_FETCH_CONCURRENCY = 5


class _FetchTarget(NamedTuple):
    """併發抓取時帶的純值。

    coroutine 裡不碰 ORM 物件：Session 既非 thread-safe 也非 coroutine-safe，
    而且 commit 後屬性會過期，之後每次讀取都會回頭打一次 DB。
    """
    repo_id: int
    owner: str
    name: str
    full_name: str


async def fetch_all_context_signals(db: Session) -> dict[str, Any]:
    """
    為追蹤清單中所有 repo 抓取情境訊號。

    網路併發、DB 寫入序列：先把所有 repo 的 HN 查詢跑完，再依序寫入。
    寫入不能一起併發，理由見 _FetchTarget。

    Args:
        db: 資料庫 session

    Returns:
        摘要統計字典
    """
    # noinspection PyTypeChecker
    repos: list[Repo] = db.query(Repo).all()
    targets = [
        _FetchTarget(int(r.id), str(r.owner), str(r.name), str(r.full_name))
        for r in repos
    ]

    sem = asyncio.Semaphore(CONTEXT_FETCH_CONCURRENCY)

    async def _fetch_one(
        target: _FetchTarget,
    ) -> tuple[_FetchTarget, list[HNStory] | None, Exception | None]:
        async with sem:
            try:
                return target, await fetch_hn_mentions(target.owner, target.name), None
            except Exception as e:  # 安全網：單一 repo 失敗不中斷整個 batch
                return target, None, e

    fetched = await asyncio.gather(*(_fetch_one(t) for t in targets))

    total_hn = 0
    errors = 0

    for target, stories, fetch_error in fetched:
        if fetch_error is not None:
            errors += 1
            logger.error(
                f"[上下文] 抓取 {target.full_name} 上下文訊號失敗: {fetch_error}",
                exc_info=fetch_error,
            )
            continue
        try:
            hn = _store_and_commit(target.repo_id, stories, db)
            total_hn += hn
            logger.debug(f"[上下文] {target.full_name} 上下文訊號: HN={hn}")
        except SQLAlchemyError as e:
            db.rollback()
            errors += 1
            logger.error(f"[上下文] {target.full_name} HN 訊號儲存失敗: {e}", exc_info=True)

    return {
        "repos_processed": len(repos),
        "new_hn_signals": total_hn,
        "errors": errors,
    }


def _cleanup_signals_by_age(db: Session, cutoff: datetime) -> int:
    """
    刪除超過指定時間的情境訊號。

    Args:
        db: 資料庫 session
        cutoff: 刪除此時間之前的訊號（datetime，非 date）

    Returns:
        刪除的訊號數量
    """
    deleted = db.query(ContextSignal).filter(
        ContextSignal.fetched_at < cutoff
    ).delete(synchronize_session=False)
    return deleted


def _cleanup_signals_by_limit(db: Session, max_per_repo: int) -> int:
    """
    每個 repo 僅保留最新的 max_per_repo 筆訊號。

    Args:
        db: 資料庫 session
        max_per_repo: 每個 repo 最多保留的訊號數

    Returns:
        刪除的訊號總數
    """
    total_deleted = 0

    # 先取得超過 max_per_repo 的 repo ID
    repo_counts = (
        db.query(ContextSignal.repo_id, func.count(ContextSignal.id).label("count"))
        .group_by(ContextSignal.repo_id)
        .having(func.count(ContextSignal.id) > max_per_repo)
        .all()
    )

    for repo_id, _ in repo_counts:
        # 取得要保留的訊號 ID（最新的 max_per_repo 筆）
        keep_ids = (
            db.query(ContextSignal.id)
            .filter(ContextSignal.repo_id == repo_id)
            .order_by(ContextSignal.fetched_at.desc())
            .limit(max_per_repo)
            .subquery()
        )

        # 刪除不在保留清單中的訊號
        deleted = (
            db.query(ContextSignal)
            .filter(
                ContextSignal.repo_id == repo_id,
                ~ContextSignal.id.in_(keep_ids)  # type: ignore[arg-type]
            )
            .delete(synchronize_session=False)
        )
        total_deleted += deleted

    return total_deleted


def _cleanup_irrelevant_signals(db: Session) -> int:
    """刪除以現行關聯規則來看不該存在的 HN 訊號。

    收緊比對規則只會影響之後抓的；已經存進來的錯誤訊號會一直留到過期為止，
    而它們往往分數很高（借用普通字命中的都是熱門故事），會一直霸佔畫面前幾名。
    每次抓取後重跑一次判定，規則日後再調整也會自動收斂，不必記得跑一次性腳本。
    """
    rows = (
        db.query(ContextSignal, Repo.owner, Repo.name)
        .join(Repo, Repo.id == ContextSignal.repo_id)
        .filter(ContextSignal.signal_type == ContextSignalType.HACKER_NEWS)
        .all()
    )

    stale_ids = [
        signal.id
        for signal, owner, name in rows
        if not is_relevant_story(signal.title or "", signal.url or "", owner, name)
    ]
    if not stale_ids:
        return 0

    return db.query(ContextSignal).filter(ContextSignal.id.in_(stale_ids)).delete(
        synchronize_session=False
    )


def cleanup_old_context_signals(
    db: Session,
    max_age_days: int = CONTEXT_SIGNAL_MAX_AGE_DAYS,
    max_per_repo: int = CONTEXT_SIGNAL_MAX_PER_REPO
) -> dict[str, int]:
    """
    移除舊的情境訊號以防止資料庫無限成長。

    策略：
    1. 移除超過 max_age_days 的訊號
    2. 每個 repo 僅保留最新的 max_per_repo 筆訊號
    3. 移除以現行關聯規則來看不該存在的訊號

    Args:
        db: 資料庫 session
        max_age_days: 移除超過此天數的訊號（預設 90）
        max_per_repo: 每個 repo 最多保留的訊號數（預設 100）

    Returns:
        清理統計：{deleted_by_age, deleted_by_limit, deleted_as_irrelevant}
    """
    # 1. 刪除超過 max_age_days 的訊號
    cutoff_date = utc_now() - timedelta(days=max_age_days)
    deleted_by_age = _cleanup_signals_by_age(db, cutoff_date)

    # 2. 每個 repo 僅保留最新的 max_per_repo 筆訊號
    deleted_by_limit = _cleanup_signals_by_limit(db, max_per_repo)

    # 3. 刪除比對規則收緊後不再成立的訊號
    deleted_as_irrelevant = _cleanup_irrelevant_signals(db)

    db.commit()

    if deleted_by_age > 0 or deleted_by_limit > 0 or deleted_as_irrelevant > 0:
        logger.info(
            f"[上下文] 上下文訊號清理: 依時間刪除 {deleted_by_age} 筆、"
            f"依上限刪除 {deleted_by_limit} 筆、"
            f"因與 repo 無關刪除 {deleted_as_irrelevant} 筆"
        )

    return {
        "deleted_by_age": deleted_by_age,
        "deleted_by_limit": deleted_by_limit,
        "deleted_as_irrelevant": deleted_as_irrelevant,
    }
