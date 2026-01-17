"""
Background scheduler service for periodic data fetching.
Uses APScheduler to run jobs at configured intervals.
"""

import logging
from datetime import datetime
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy.orm import Session

from db.database import SessionLocal
from db.models import Repo, RepoSnapshot
from services.github import fetch_repo_data
from services.analyzer import calculate_signals

logger = logging.getLogger(__name__)

# Global scheduler instance
_scheduler: Optional[AsyncIOScheduler] = None


def get_scheduler() -> AsyncIOScheduler:
    """Get the global scheduler instance."""
    global _scheduler
    if _scheduler is None:
        _scheduler = AsyncIOScheduler()
    return _scheduler


async def fetch_all_repos_job():
    """
    Background job to fetch all repos in the watchlist.
    This runs periodically based on the configured interval.
    """
    logger.info("Starting scheduled fetch for all repos...")

    db: Session = SessionLocal()
    try:
        repos = db.query(Repo).all()

        if not repos:
            logger.info("No repos in watchlist, skipping fetch")
            return

        success_count = 0
        error_count = 0

        for repo in repos:
            try:
                # Fetch latest data from GitHub
                github_data = await fetch_repo_data(repo.owner, repo.name)

                if github_data:
                    # Create new snapshot
                    snapshot = RepoSnapshot(
                        repo_id=repo.id,
                        stars=github_data.get("stargazers_count", 0),
                        forks=github_data.get("forks_count", 0),
                        watchers=github_data.get("subscribers_count", 0),
                        open_issues=github_data.get("open_issues_count", 0),
                        snapshot_date=datetime.now().date(),
                        fetched_at=datetime.now()
                    )
                    db.add(snapshot)

                    # Update repo metadata
                    repo.description = github_data.get("description")
                    repo.language = github_data.get("language")
                    repo.updated_at = datetime.now()

                    db.commit()

                    # Calculate signals
                    calculate_signals(db, repo.id)

                    success_count += 1
                    logger.debug(f"Fetched {repo.full_name}: {snapshot.stars} stars")
                else:
                    error_count += 1
                    logger.warning(f"Failed to fetch data for {repo.full_name}")

            except Exception as e:
                error_count += 1
                logger.error(f"Error fetching {repo.full_name}: {e}")
                db.rollback()

        logger.info(f"Scheduled fetch complete: {success_count} success, {error_count} errors")

    except Exception as e:
        logger.error(f"Scheduler job error: {e}")
    finally:
        db.close()


async def check_alerts_job():
    """
    Background job to check alert rules and trigger notifications.
    This runs after fetching data.
    """
    logger.info("Checking alert rules...")

    db: Session = SessionLocal()
    try:
        # Import here to avoid circular imports
        from services.alerts import check_all_alerts

        triggered = await check_all_alerts(db)

        if triggered:
            logger.info(f"Triggered {len(triggered)} alerts")
        else:
            logger.debug("No alerts triggered")

    except ImportError:
        # alerts service not yet implemented
        logger.debug("Alerts service not yet available")
    except Exception as e:
        logger.error(f"Error checking alerts: {e}")
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
        trigger=IntervalTrigger(minutes=fetch_interval_minutes, start_date=datetime.now()),
        id="check_alerts",
        name="Check alert rules",
        replace_existing=True,
        max_instances=1,
    )

    scheduler.start()
    logger.info(f"Scheduler started with {fetch_interval_minutes} minute interval")


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
    """Manually trigger an immediate fetch of all repos."""
    logger.info("Manual fetch triggered")
    await fetch_all_repos_job()
    await check_alerts_job()
