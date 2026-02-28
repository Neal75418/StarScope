"""
情境訊號抓取服務。
簡化為僅從 Hacker News 抓取。
"""

import logging
from datetime import timedelta
from typing import List, Dict, Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from constants import ContextSignalType
from db.models import Repo, ContextSignal
from services.hacker_news import fetch_hn_mentions, HNStory
from utils.time import utc_now

# 清理設定
CONTEXT_SIGNAL_MAX_AGE_DAYS = 90  # Remove signals older than this
CONTEXT_SIGNAL_MAX_PER_REPO = 100  # Keep at most this many signals per repo

logger = logging.getLogger(__name__)


def _get_existing_signal_map(
    repo_id: int,
    signal_type: str,
    external_ids: List[str],
    db: Session
) -> Dict[str, "ContextSignal"]:
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


def _store_hn_signals(repo_id: int, stories: List[HNStory], db: Session) -> int:
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

    count = 0
    for story in stories:
        existing = existing_map.get(story.object_id)

        if existing:
            _update_existing_signal(existing, story.points, story.num_comments)
        else:
            db.add(ContextSignal(
                repo_id=repo_id,
                signal_type=ContextSignalType.HACKER_NEWS,
                external_id=story.object_id,
                title=story.title,
                url=story.url,
                score=story.points,
                comment_count=story.num_comments,
                author=story.author,
                published_at=story.created_at,
            ))
            count += 1

    return count


async def fetch_context_signals_for_repo(repo: "Repo", db: Session) -> int:
    """
    為單一 repo 抓取 HN 情境訊號。

    Args:
        repo: Repo model 物件
        db: 資料庫 session

    Returns:
        新增的 HN 訊號數量
    """
    try:
        hn_stories = await fetch_hn_mentions(repo.owner, repo.name)
        hn_count = _store_hn_signals(repo.id, hn_stories, db) if hn_stories else 0
    except Exception as e:
        logger.warning(f"[上下文] {repo.full_name} HN 抓取失敗: {e}")
        hn_count = 0

    db.commit()
    return hn_count


async def fetch_all_context_signals(db: Session) -> Dict[str, Any]:
    """
    為追蹤清單中所有 repo 抓取情境訊號。

    Args:
        db: 資料庫 session

    Returns:
        摘要統計字典
    """
    # noinspection PyTypeChecker
    repos: List[Repo] = db.query(Repo).all()

    total_hn = 0
    errors = 0

    for repo in repos:
        try:
            hn = await fetch_context_signals_for_repo(repo, db)
            total_hn += hn
            logger.debug(f"[上下文] {repo.full_name} 上下文訊號: HN={hn}")
        except Exception as e:
            errors += 1
            logger.error(f"[上下文] 抓取 {repo.full_name} 上下文訊號失敗: {e}", exc_info=True)

    return {
        "repos_processed": len(repos),
        "new_hn_signals": total_hn,
        "errors": errors,
    }


def _cleanup_signals_by_age(db: Session, cutoff_date) -> int:
    """
    刪除超過指定時間的情境訊號。

    Args:
        db: 資料庫 session
        cutoff_date: 刪除此時間之前的訊號

    Returns:
        刪除的訊號數量
    """
    deleted = db.query(ContextSignal).filter(
        ContextSignal.fetched_at < cutoff_date
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


def cleanup_old_context_signals(
    db: Session,
    max_age_days: int = CONTEXT_SIGNAL_MAX_AGE_DAYS,
    max_per_repo: int = CONTEXT_SIGNAL_MAX_PER_REPO
) -> Dict[str, int]:
    """
    移除舊的情境訊號以防止資料庫無限成長。

    策略：
    1. 移除超過 max_age_days 的訊號
    2. 每個 repo 僅保留最新的 max_per_repo 筆訊號

    Args:
        db: 資料庫 session
        max_age_days: 移除超過此天數的訊號（預設 90）
        max_per_repo: 每個 repo 最多保留的訊號數（預設 100）

    Returns:
        清理統計：{deleted_by_age, deleted_by_limit}
    """
    # 1. 刪除超過 max_age_days 的訊號
    cutoff_date = utc_now() - timedelta(days=max_age_days)
    deleted_by_age = _cleanup_signals_by_age(db, cutoff_date)

    # 2. 每個 repo 僅保留最新的 max_per_repo 筆訊號
    deleted_by_limit = _cleanup_signals_by_limit(db, max_per_repo)

    db.commit()

    if deleted_by_age > 0 or deleted_by_limit > 0:
        logger.info(
            f"[上下文] 上下文訊號清理: 依時間刪除 {deleted_by_age} 筆、"
            f"依上限刪除 {deleted_by_limit} 筆"
        )

    return {"deleted_by_age": deleted_by_age, "deleted_by_limit": deleted_by_limit}
