"""
Context signal fetcher service.
Simplified to only fetch from Hacker News.
"""

import logging
from typing import List, Dict, Any

from sqlalchemy.orm import Session

from db.models import Repo, ContextSignal, ContextSignalType
from services.hacker_news import fetch_hn_mentions, HNStory
from utils.time import utc_now

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
