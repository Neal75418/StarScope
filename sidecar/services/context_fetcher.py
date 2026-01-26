"""
Context signal fetcher service.
Orchestrates fetching from all external sources and storing context signals.
"""

import asyncio
import logging
from typing import List, Tuple, Dict, Any

from sqlalchemy.orm import Session

from db.models import Repo, ContextSignal, ContextSignalType
from services.hacker_news import fetch_hn_mentions, HNStory
from services.reddit import fetch_reddit_mentions, RedditPost
from services.releases import fetch_releases, GitHubRelease
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


def _store_reddit_signals(repo_id: int, posts: List[RedditPost], db: Session) -> int:
    """
    Store Reddit posts as context signals.

    Args:
        repo_id: Repository ID
        posts: List of RedditPost objects
        db: Database session

    Returns:
        Count of new signals added
    """
    if not posts:
        return 0

    # Batch load existing signals
    external_ids = [p.post_id for p in posts]
    existing_map = _get_existing_signal_map(
        repo_id, ContextSignalType.REDDIT, external_ids, db
    )

    count = 0
    for post in posts:
        existing = existing_map.get(post.post_id)

        if existing:
            _update_existing_signal(existing, post.score, post.num_comments)
        else:
            db.add(ContextSignal(
                repo_id=repo_id,
                signal_type=ContextSignalType.REDDIT,
                external_id=post.post_id,
                title=post.title,
                url=post.permalink,
                score=post.score,
                comment_count=post.num_comments,
                author=post.author,
                published_at=post.created_at,
            ))
            count += 1

    return count


def _store_release_signals(repo_id: int, releases: List[GitHubRelease], db: Session) -> int:
    """
    Store GitHub releases as context signals.

    Args:
        repo_id: Repository ID
        releases: List of GitHubRelease objects
        db: Database session

    Returns:
        Count of new signals added
    """
    # Filter out draft releases first
    releases = [r for r in releases if not r.is_draft]
    if not releases:
        return 0

    # Batch load existing signals
    external_ids = [str(r.release_id) for r in releases]
    existing_map = _get_existing_signal_map(
        repo_id, ContextSignalType.GITHUB_RELEASE, external_ids, db
    )

    count = 0
    for release in releases:
        external_id = str(release.release_id)
        if external_id not in existing_map:
            signal = ContextSignal(
                repo_id=repo_id,
                signal_type=ContextSignalType.GITHUB_RELEASE,
                external_id=external_id,
                title=release.name,
                url=release.url,
                author=release.author,
                version_tag=release.tag_name,
                is_prerelease=release.is_prerelease,
                published_at=release.published_at or release.created_at,
            )
            db.add(signal)
            count += 1

    return count


async def fetch_context_signals_for_repo(repo: "Repo", db: Session) -> Tuple[int, int, int]:
    """
    Fetch all context signals for a single repository.
    Fetches from HN, Reddit, and GitHub in parallel for better performance.

    Args:
        repo: Repository model object
        db: Database session

    Returns:
        Tuple of (hn_count, reddit_count, release_count) new signals added
    """
    # Fetch all sources in parallel
    hn_task = fetch_hn_mentions(repo.owner, repo.name)
    reddit_task = fetch_reddit_mentions(repo.owner, repo.name)
    releases_task = fetch_releases(repo.owner, repo.name)

    hn_stories, reddit_posts, releases = await asyncio.gather(
        hn_task, reddit_task, releases_task,
        return_exceptions=True  # Don't fail if one source errors
    )

    # Handle results, treating exceptions as empty results
    hn_count = 0
    if isinstance(hn_stories, list):
        hn_count = _store_hn_signals(repo.id, hn_stories, db)
    elif isinstance(hn_stories, Exception):
        logger.warning(f"HN fetch failed for {repo.full_name}: {hn_stories}")

    reddit_count = 0
    if isinstance(reddit_posts, list):
        reddit_count = _store_reddit_signals(repo.id, reddit_posts, db)
    elif isinstance(reddit_posts, Exception):
        logger.warning(f"Reddit fetch failed for {repo.full_name}: {reddit_posts}")

    release_count = 0
    if isinstance(releases, list):
        release_count = _store_release_signals(repo.id, releases, db)
    elif isinstance(releases, Exception):
        logger.warning(f"Releases fetch failed for {repo.full_name}: {releases}")

    db.commit()
    return hn_count, reddit_count, release_count


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
    total_reddit = 0
    total_releases = 0
    errors = 0

    for repo in repos:
        try:
            hn, reddit, releases = await fetch_context_signals_for_repo(repo, db)
            total_hn += hn
            total_reddit += reddit
            total_releases += releases
            logger.debug(
                f"Context signals for {repo.full_name}: "
                f"HN={hn}, Reddit={reddit}, Releases={releases}"
            )
        except Exception as e:
            errors += 1
            logger.error(f"Error fetching context signals for {repo.full_name}: {e}", exc_info=True)

    return {
        "repos_processed": len(repos),
        "new_hn_signals": total_hn,
        "new_reddit_signals": total_reddit,
        "new_release_signals": total_releases,
        "errors": errors,
    }
