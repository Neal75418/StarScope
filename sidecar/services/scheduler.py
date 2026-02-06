"""
Background scheduler service for periodic data fetching.
Uses APScheduler to run jobs at configured intervals.
"""

import asyncio
import logging
import threading
from datetime import timedelta
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy.orm import Session

from db.database import SessionLocal
from db.models import Repo, RepoSnapshot
from services.github import fetch_repo_data
from services.analyzer import calculate_signals
from services.context_fetcher import fetch_all_context_signals
from utils.time import utc_now, utc_today
from constants import CONTEXT_FETCH_INTERVAL_MINUTES

logger = logging.getLogger(__name__)

# Global scheduler instance
_scheduler: Optional[AsyncIOScheduler] = None
_scheduler_lock = threading.Lock()


def get_scheduler() -> AsyncIOScheduler:
    """Get the global scheduler instance."""
    global _scheduler
    if _scheduler is None:
        with _scheduler_lock:
            if _scheduler is None:
                _scheduler = AsyncIOScheduler()
    return _scheduler


async def fetch_all_repos_job(skip_recent_minutes: int = 30):
    """
    Background job to fetch all repos in the watchlist.
    This runs periodically based on the configured interval.

    Args:
        skip_recent_minutes: Skip repos fetched within this many minutes (default: 30).
                           This prevents re-fetching after a restart.
    """
    logger.info("Starting scheduled fetch for all repos...")

    db: Session = SessionLocal()
    try:
        repos = db.query(Repo).all()

        if not repos:
            logger.info("No repos in watchlist, skipping fetch")
            return

        # Get last fetch time for each repo to enable smart skipping
        from sqlalchemy import func
        # Use naive datetime for comparison with DB values (SQLite stores naive datetimes)
        recent_threshold = (utc_now() - timedelta(minutes=skip_recent_minutes)).replace(tzinfo=None)

        # Query repos with their latest snapshot fetch time
        latest_fetches = dict(
            db.query(RepoSnapshot.repo_id, func.max(RepoSnapshot.fetched_at))
            .group_by(RepoSnapshot.repo_id)
            .all()
        )

        success_count = 0
        error_count = 0
        skipped_count = 0

        for repo in repos:
            # Skip repos that were recently fetched (prevents redundant fetches after restart)
            last_fetch = latest_fetches.get(repo.id)
            if last_fetch and last_fetch > recent_threshold:
                skipped_count += 1
                # Use naive datetime for comparison
                now_naive = utc_now().replace(tzinfo=None)
                logger.debug(f"Skipping {repo.full_name}: fetched {(now_naive - last_fetch).seconds // 60}min ago")
                continue

            try:
                # Fetch latest data from GitHub
                github_data = await fetch_repo_data(repo.owner, repo.name)

                if github_data:
                    # Upsert snapshot: update if one already exists for today
                    today = utc_today()
                    existing_snapshot = db.query(RepoSnapshot).filter(
                        RepoSnapshot.repo_id == repo.id,
                        RepoSnapshot.snapshot_date == today,
                    ).first()

                    if existing_snapshot:
                        existing_snapshot.stars = github_data.get("stargazers_count", 0)
                        existing_snapshot.forks = github_data.get("forks_count", 0)
                        existing_snapshot.watchers = github_data.get("subscribers_count", 0)
                        existing_snapshot.open_issues = github_data.get("open_issues_count", 0)
                        existing_snapshot.fetched_at = utc_now()
                        snapshot = existing_snapshot
                    else:
                        snapshot = RepoSnapshot(
                            repo_id=repo.id,
                            stars=github_data.get("stargazers_count", 0),
                            forks=github_data.get("forks_count", 0),
                            watchers=github_data.get("subscribers_count", 0),
                            open_issues=github_data.get("open_issues_count", 0),
                            snapshot_date=today,
                            fetched_at=utc_now()
                        )
                        db.add(snapshot)

                    # Update repo metadata
                    repo.description = github_data.get("description")
                    repo.language = github_data.get("language")
                    repo.updated_at = utc_now()

                    db.commit()

                    # Calculate signals
                    calculate_signals(repo.id, db)

                    success_count += 1
                    logger.debug(f"Fetched {repo.full_name}: {snapshot.stars} stars")
                else:
                    error_count += 1
                    logger.warning(f"Failed to fetch data for {repo.full_name}")

            except Exception as e:
                error_count += 1
                db.rollback()
                logger.error(f"Error fetching {repo.full_name}: {e}", exc_info=True)

        logger.info(
            f"Scheduled fetch complete: {success_count} success, "
            f"{error_count} errors, {skipped_count} skipped (recently fetched)"
        )

    except Exception as e:
        logger.error(f"Scheduler job error: {e}", exc_info=True)
    finally:
        db.close()


def check_alerts_job():
    """
    Background job to check alert rules and trigger notifications.
    This runs after fetching data.
    """
    logger.info("Checking alert rules...")

    # Import here to avoid circular imports
    try:
        from services.alerts import check_all_alerts
    except ImportError:
        # alerts service not yet implemented
        logger.debug("Alerts service not yet available")
        return

    db: Session = SessionLocal()
    try:
        triggered = check_all_alerts(db)

        if triggered:
            logger.info(f"Triggered {len(triggered)} alerts")
        else:
            logger.debug("No alerts triggered")

    except Exception as e:
        logger.error(f"Error checking alerts: {e}", exc_info=True)
    finally:
        db.close()


async def fetch_context_signals_job():
    """
    Background job to fetch context signals for all repos.
    Fetches from Hacker News and runs cleanup.
    """
    logger.info("Starting scheduled context signals fetch...")

    db: Session = SessionLocal()
    try:
        result = await fetch_all_context_signals(db)
        logger.info(
            f"Context signals fetch complete: "
            f"HN={result['new_hn_signals']}, "
            f"Errors={result['errors']}"
        )

        # Run cleanup to prevent unbounded growth
        from services.context_fetcher import cleanup_old_context_signals
        cleanup_stats = cleanup_old_context_signals(db)
        if cleanup_stats["deleted_by_age"] > 0 or cleanup_stats["deleted_by_limit"] > 0:
            logger.info(f"Context signal cleanup: {cleanup_stats}")
    except Exception as e:
        logger.error(f"Context signals job error: {e}", exc_info=True)
    finally:
        db.close()


def start_scheduler(fetch_interval_minutes: int = 60):
    """
    Start the background scheduler.

    Args:
        fetch_interval_minutes: How often to fetch data (default: 60 minutes)
    """
    scheduler = get_scheduler()

    if scheduler.running:
        logger.warning("Scheduler already running")
        return

    # Add the fetch job
    scheduler.add_job(
        fetch_all_repos_job,
        trigger=IntervalTrigger(minutes=fetch_interval_minutes),
        id="fetch_all_repos",
        name="Fetch all repos from GitHub",
        replace_existing=True,
        max_instances=1,  # Prevent overlapping runs
    )

    # Add the alerts check job (runs 1 minute after fetch)
    scheduler.add_job(
        check_alerts_job,
        trigger=IntervalTrigger(
            minutes=fetch_interval_minutes,
            start_date=utc_now() + timedelta(minutes=1),
        ),
        id="check_alerts",
        name="Check alert rules",
        replace_existing=True,
        max_instances=1,
    )

    # Add context signals job (runs every 30 minutes)
    scheduler.add_job(
        fetch_context_signals_job,
        trigger=IntervalTrigger(minutes=CONTEXT_FETCH_INTERVAL_MINUTES),
        id="fetch_context_signals",
        name="Fetch context signals (HN)",
        replace_existing=True,
        max_instances=1,
    )

    scheduler.start()
    logger.info(
        f"Scheduler started: data fetch every {fetch_interval_minutes}min, "
        f"context signals every {CONTEXT_FETCH_INTERVAL_MINUTES}min"
    )


def stop_scheduler():
    """Stop the background scheduler."""
    scheduler = get_scheduler()

    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")


def get_scheduler_status() -> dict:
    """Get the current scheduler status."""
    scheduler = get_scheduler()

    jobs = []
    for job in scheduler.get_jobs():
        jobs.append({
            "id": job.id,
            "name": job.name,
            "next_run": job.next_run_time.isoformat() if job.next_run_time else None,
        })

    return {
        "running": scheduler.running,
        "jobs": jobs,
    }


async def trigger_fetch_now():
    """Manually trigger an immediate fetch of all repos and context signals."""
    logger.info("Manual fetch triggered")
    await fetch_all_repos_job()
    # Run sync alert check in a thread to avoid blocking the event loop
    await asyncio.to_thread(check_alerts_job)
    # Also fetch HN context signals
    await fetch_context_signals_job()
