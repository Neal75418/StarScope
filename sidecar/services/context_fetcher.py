"""
Context signal fetcher service.
Simplified to only fetch from Hacker News.
"""

import logging
from datetime import timedelta
from typing import List, Dict, Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from db.models import Repo, ContextSignal, ContextSignalType
from services.hacker_news import fetch_hn_mentions, HNStory
from utils.time import utc_now

# Cleanup configuration
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
    Batch load existing signals to avoid N+1 queries.

    Returns:
        Dict mapping external_id to ContextSignal object
    """
    if not external_ids:
        return {}

    existing = db.query(ContextSignal).filter(
        ContextSignal.repo_id == repo_id,
        ContextSignal.signal_type == signal_type,
        ContextSignal.external_id.in_(external_ids)
    ).all()

    return {str(s.external_id): s for s in existing}


def _update_existing_signal(
    existing: "ContextSignal",
    score: int,
    comment_count: int
) -> None:
    """Update an existing signal with new score and comment count."""
    existing.score = score
    existing.comment_count = comment_count
    existing.fetched_at = utc_now()


def _store_hn_signals(repo_id: int, stories: List[HNStory], db: Session) -> int:
    """
    Store HN stories as context signals.

    Args:
        repo_id: Repository ID
        stories: List of HNStory objects
        db: Database session

    Returns:
        Count of new signals added
    """
    if not stories:
        return 0

    # Batch load existing signals
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
    Fetch HN context signals for a single repository.

    Args:
        repo: Repository model object
        db: Database session

    Returns:
        Count of new HN signals added
    """
    try:
        hn_stories = await fetch_hn_mentions(repo.owner, repo.name)
        hn_count = _store_hn_signals(repo.id, hn_stories, db) if hn_stories else 0
    except Exception as e:
        logger.warning(f"HN fetch failed for {repo.full_name}: {e}")
        hn_count = 0

    db.commit()
    return hn_count


async def fetch_all_context_signals(db: Session) -> Dict[str, Any]:
    """
    Fetch context signals for all repos in the watchlist.

    Args:
        db: Database session

    Returns:
        Summary statistics dictionary
    """
    repos = db.query(Repo).all()

    total_hn = 0
    errors = 0

    for repo in repos:
        try:
            hn = await fetch_context_signals_for_repo(repo, db)
            total_hn += hn
            logger.debug(f"Context signals for {repo.full_name}: HN={hn}")
        except Exception as e:
            errors += 1
            logger.error(f"Error fetching context signals for {repo.full_name}: {e}", exc_info=True)

    return {
        "repos_processed": len(repos),
        "new_hn_signals": total_hn,
        "errors": errors,
    }


def cleanup_old_context_signals(
    db: Session,
    max_age_days: int = CONTEXT_SIGNAL_MAX_AGE_DAYS,
    max_per_repo: int = CONTEXT_SIGNAL_MAX_PER_REPO
) -> Dict[str, int]:
    """
    Remove old context signals to prevent unbounded database growth.

    Strategy:
    1. Remove signals older than max_age_days
    2. Keep only max_per_repo most recent signals per repo

    Args:
        db: Database session
        max_age_days: Remove signals older than this (default: 90)
        max_per_repo: Keep at most this many signals per repo (default: 100)

    Returns:
        Statistics about cleanup: {deleted_by_age, deleted_by_limit}
    """
    stats = {"deleted_by_age": 0, "deleted_by_limit": 0}

    # 1. Delete signals older than max_age_days
    cutoff_date = utc_now() - timedelta(days=max_age_days)
    deleted_by_age = db.query(ContextSignal).filter(
        ContextSignal.fetched_at < cutoff_date
    ).delete(synchronize_session=False)
    stats["deleted_by_age"] = deleted_by_age

    # 2. For each repo, keep only the most recent max_per_repo signals
    # First, get repo IDs that have more than max_per_repo signals
    repo_counts = (
        db.query(ContextSignal.repo_id, func.count(ContextSignal.id).label("count"))
        .group_by(ContextSignal.repo_id)
        .having(func.count(ContextSignal.id) > max_per_repo)
        .all()
    )

    for repo_id, _ in repo_counts:
        # Get the IDs of signals to keep (most recent max_per_repo)
        keep_ids = (
            db.query(ContextSignal.id)
            .filter(ContextSignal.repo_id == repo_id)
            .order_by(ContextSignal.fetched_at.desc())
            .limit(max_per_repo)
            .subquery()
        )

        # Delete signals not in the keep list
        deleted = (
            db.query(ContextSignal)
            .filter(
                ContextSignal.repo_id == repo_id,
                ~ContextSignal.id.in_(keep_ids)
            )
            .delete(synchronize_session=False)
        )
        stats["deleted_by_limit"] += deleted

    db.commit()

    if stats["deleted_by_age"] > 0 or stats["deleted_by_limit"] > 0:
        logger.info(
            f"Context signal cleanup: {stats['deleted_by_age']} by age, "
            f"{stats['deleted_by_limit']} by limit"
        )

    return stats
