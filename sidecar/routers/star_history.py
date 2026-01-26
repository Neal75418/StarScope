"""
Star History Backfill API endpoints.
Provides historical star data backfilling for repositories with < 5000 stars.
"""

from datetime import datetime, date, timezone
from typing import List, Optional
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Repo, RepoSnapshot
from services.github import get_github_service, GitHubNotFoundError, GitHubRateLimitError, GitHubAPIError
from utils.time import utc_now

# Constants
MAX_STARS_FOR_BACKFILL = 5000
ERROR_REPO_NOT_FOUND = "Repository not found"
ERROR_TOO_MANY_STARS = f"Repository has too many stars (>{MAX_STARS_FOR_BACKFILL}). Backfill is not available."

router = APIRouter(prefix="/star-history", tags=["star-history"])


# Response schemas
class BackfillStatus(BaseModel):
    """Status of backfill operation."""
    repo_id: int
    repo_name: str
    can_backfill: bool
    current_stars: int
    max_stars_allowed: int
    has_backfilled_data: bool
    backfilled_days: int
    message: str


class BackfillResult(BaseModel):
    """Result of backfill operation."""
    repo_id: int
    repo_name: str
    success: bool
    total_stargazers: int
    snapshots_created: int
    earliest_date: Optional[str]  # ISO format date string
    latest_date: Optional[str]  # ISO format date string
    message: str


class StarHistoryPoint(BaseModel):
    """A point in star history."""
    date: date
    stars: int


class StarHistoryResponse(BaseModel):
    """Full star history response."""
    repo_id: int
    repo_name: str
    history: List[StarHistoryPoint]
    is_backfilled: bool
    total_points: int


# Helper functions
def _get_repo_or_404(repo_id: int, db: Session) -> Repo:
    """Get repo by ID or raise 404."""
    repo = db.query(Repo).filter(Repo.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail=ERROR_REPO_NOT_FOUND)
    return repo


def _parse_starred_at(starred_at: str) -> Optional[date]:
    """Parse ISO datetime string to date."""
    if not starred_at:
        return None
    try:
        return datetime.fromisoformat(starred_at.replace("Z", "+00:00")).date()
    except (ValueError, TypeError):
        return None


def _aggregate_stargazers_by_date(stargazers: List[dict]) -> dict[date, int]:
    """
    Aggregate stargazers by date, returning cumulative star count per day.

    Args:
        stargazers: List of {"starred_at": "...", "user": {...}}

    Returns:
        Dict mapping date to cumulative star count
    """
    # Count stars per day
    stars_per_day: dict[date, int] = defaultdict(int)

    for sg in stargazers:
        starred_at = sg.get("starred_at")
        star_date = _parse_starred_at(starred_at)
        if star_date:
            stars_per_day[star_date] += 1

    if not stars_per_day:
        return {}

    # Sort dates and compute cumulative counts
    sorted_dates = sorted(stars_per_day.keys())
    cumulative: dict[date, int] = {}
    running_total = 0

    for d in sorted_dates:
        running_total += stars_per_day[d]
        cumulative[d] = running_total

    return cumulative


def _create_snapshots_from_history(
    db: Session,
    repo_id: int,
    star_history: dict[date, int]
) -> int:
    """
    Create or update RepoSnapshot records from star history.
    Returns number of snapshots created/updated.
    """
    count = 0
    now = utc_now()

    try:
        for snapshot_date, stars in star_history.items():
            # Check if snapshot exists
            existing = db.query(RepoSnapshot).filter(
                RepoSnapshot.repo_id == repo_id,
                RepoSnapshot.snapshot_date == snapshot_date
            ).first()

            if existing:
                # Update if backfilled data has more accurate star count
                # (only update if our backfilled count is higher, indicating we have more complete data)
                if stars > existing.stars:
                    existing.stars = stars
                    existing.fetched_at = now
                    count += 1
            else:
                # Create new snapshot
                snapshot = RepoSnapshot(
                    repo_id=repo_id,
                    stars=stars,
                    forks=0,  # Unknown for historical data
                    watchers=0,
                    open_issues=0,
                    snapshot_date=snapshot_date,
                    fetched_at=now,
                )
                db.add(snapshot)
                count += 1

        db.commit()
        return count
    except Exception:
        db.rollback()
        raise


# Endpoints
@router.get("/{repo_id}/status", response_model=BackfillStatus)
async def get_backfill_status(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    Check if a repository is eligible for star history backfill.
    """
    repo = _get_repo_or_404(repo_id, db)

    # Get current star count from latest snapshot
    latest_snapshot = db.query(RepoSnapshot).filter(
        RepoSnapshot.repo_id == repo_id
    ).order_by(RepoSnapshot.snapshot_date.desc()).first()

    current_stars = latest_snapshot.stars if latest_snapshot else 0

    # Count existing snapshots
    snapshot_count = db.query(RepoSnapshot).filter(
        RepoSnapshot.repo_id == repo_id
    ).count()

    can_backfill = current_stars <= MAX_STARS_FOR_BACKFILL
    has_data = snapshot_count > 1  # More than just today's snapshot

    if can_backfill:
        message = "Repository is eligible for star history backfill."
    else:
        message = f"Repository has {current_stars} stars, exceeding the {MAX_STARS_FOR_BACKFILL} limit."

    return BackfillStatus(
        repo_id=repo.id,
        repo_name=repo.full_name,
        can_backfill=can_backfill,
        current_stars=current_stars,
        max_stars_allowed=MAX_STARS_FOR_BACKFILL,
        has_backfilled_data=has_data,
        backfilled_days=snapshot_count,
        message=message,
    )


@router.post("/{repo_id}/backfill", response_model=BackfillResult)
async def backfill_star_history(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    Backfill star history for a repository.

    Only available for repositories with < 5000 stars.
    Fetches all stargazers with timestamps and creates historical snapshots.
    """
    repo = _get_repo_or_404(repo_id, db)

    try:
        service = get_github_service()

        # Fetch stargazers with dates (includes star count check)
        stargazers = await service.get_stargazers_with_dates(
            repo.owner, repo.name, max_stars=MAX_STARS_FOR_BACKFILL
        )

        if not stargazers:
            # Either no stars or exceeds limit
            latest = db.query(RepoSnapshot).filter(
                RepoSnapshot.repo_id == repo_id
            ).order_by(RepoSnapshot.snapshot_date.desc()).first()

            current_stars = latest.stars if latest else 0

            if current_stars > MAX_STARS_FOR_BACKFILL:
                return BackfillResult(
                    repo_id=repo.id,
                    repo_name=repo.full_name,
                    success=False,
                    total_stargazers=0,
                    snapshots_created=0,
                    earliest_date=None,
                    latest_date=None,
                    message=ERROR_TOO_MANY_STARS,
                )
            else:
                return BackfillResult(
                    repo_id=repo.id,
                    repo_name=repo.full_name,
                    success=True,
                    total_stargazers=0,
                    snapshots_created=0,
                    earliest_date=None,
                    latest_date=None,
                    message="No stargazers found.",
                )

        # Aggregate by date
        star_history = _aggregate_stargazers_by_date(stargazers)

        if not star_history:
            return BackfillResult(
                repo_id=repo.id,
                repo_name=repo.full_name,
                success=True,
                total_stargazers=len(stargazers),
                snapshots_created=0,
                earliest_date=None,
                latest_date=None,
                message="Stargazers found but no valid dates.",
            )

        # Create snapshots
        snapshots_created = _create_snapshots_from_history(db, repo_id, star_history)

        sorted_dates = sorted(star_history.keys())

        # Handle case where no new snapshots were created (all existing had higher counts)
        if snapshots_created == 0:
            return BackfillResult(
                repo_id=repo.id,
                repo_name=repo.full_name,
                success=True,
                total_stargazers=len(stargazers),
                snapshots_created=0,
                earliest_date=None,
                latest_date=None,
                message="No new snapshots created - existing data is up to date.",
            )

        return BackfillResult(
            repo_id=repo.id,
            repo_name=repo.full_name,
            success=True,
            total_stargazers=len(stargazers),
            snapshots_created=snapshots_created,
            earliest_date=sorted_dates[0].isoformat(),
            latest_date=sorted_dates[-1].isoformat(),
            message=f"Successfully backfilled {snapshots_created} days of star history.",
        )

    except GitHubNotFoundError:
        raise HTTPException(status_code=404, detail=f"Repository not found on GitHub: {repo.full_name}")
    except GitHubRateLimitError:
        raise HTTPException(status_code=429, detail="GitHub API rate limit exceeded. Please try again later.")
    except GitHubAPIError as e:
        raise HTTPException(status_code=502, detail=f"GitHub API error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to backfill star history: {str(e)}")


@router.get("/{repo_id}", response_model=StarHistoryResponse)
async def get_star_history(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    Get the full star history for a repository.
    Returns all available snapshots ordered by date.
    """
    repo = _get_repo_or_404(repo_id, db)

    snapshots = db.query(RepoSnapshot).filter(
        RepoSnapshot.repo_id == repo_id
    ).order_by(RepoSnapshot.snapshot_date.asc()).all()

    history = [
        StarHistoryPoint(date=s.snapshot_date, stars=s.stars)
        for s in snapshots
    ]

    # Determine if data looks backfilled (has data older than 30 days)
    is_backfilled = False
    if history:
        oldest = history[0].date
        today = date.today()
        is_backfilled = (today - oldest).days > 30

    return StarHistoryResponse(
        repo_id=repo.id,
        repo_name=repo.full_name,
        history=history,
        is_backfilled=is_backfilled,
        total_points=len(history),
    )
