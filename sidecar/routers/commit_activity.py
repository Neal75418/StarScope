"""
Commit Activity API endpoints.
Provides weekly commit activity data for repositories.
"""

from datetime import datetime, date, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

from db.database import get_db
from db.models import Repo, CommitActivity
from routers.dependencies import get_repo_or_404
from services.github import get_github_service, GitHubNotFoundError, GitHubRateLimitError, GitHubAPIError
from utils.time import utc_now

ERROR_FETCH_FAILED = "Failed to fetch commit activity from GitHub"

router = APIRouter(prefix="/commit-activity", tags=["commit-activity"])


# Response schemas
class CommitWeekResponse(BaseModel):
    """Weekly commit data."""
    week_start: date
    commit_count: int


class CommitActivityResponse(BaseModel):
    """Commit activity response with summary statistics."""
    repo_id: int
    repo_name: str
    weeks: List[CommitWeekResponse]
    total_commits_52w: int
    avg_commits_per_week: float
    last_updated: Optional[datetime]


class CommitActivitySummary(BaseModel):
    """Brief summary for badges/cards."""
    repo_id: int
    total_commits_52w: int
    avg_commits_per_week: float
    last_updated: Optional[datetime]


# Helper functions
def _build_response(repo: Repo, activities: List[CommitActivity]) -> CommitActivityResponse:
    """Build CommitActivityResponse from repo and activity records."""
    weeks = [
        CommitWeekResponse(week_start=a.week_start, commit_count=a.commit_count)
        for a in sorted(activities, key=lambda x: x.week_start)
    ]

    total = sum(a.commit_count for a in activities)
    avg = total / len(activities) if activities else 0.0
    last_updated = max((a.fetched_at for a in activities), default=None) if activities else None

    return CommitActivityResponse(
        repo_id=repo.id,
        repo_name=repo.full_name,
        weeks=weeks,
        total_commits_52w=total,
        avg_commits_per_week=round(avg, 2),
        last_updated=last_updated,
    )


def _store_commit_activity(
    db: Session,
    repo_id: int,
    github_data: List[dict]
) -> List[CommitActivity]:
    """
    Store commit activity data from GitHub API response.

    GitHub returns: [{week: timestamp, total: int, days: [int x 7]}, ...]
    """
    # Delete existing data for this repo (replace strategy)
    db.query(CommitActivity).filter(CommitActivity.repo_id == repo_id).delete()

    activities = []
    now = utc_now()

    for week_data in github_data:
        # GitHub returns Unix timestamp for week start
        week_timestamp = week_data.get("week", 0)
        commit_count = week_data.get("total", 0)

        if week_timestamp > 0:
            # Use UTC to ensure consistent date across timezones
            week_start = datetime.fromtimestamp(week_timestamp, tz=timezone.utc).date()
            activity = CommitActivity(
                repo_id=repo_id,
                week_start=week_start,
                commit_count=commit_count,
                fetched_at=now,
            )
            activities.append(activity)

    db.add_all(activities)
    db.commit()

    return activities


# Endpoints
@router.get("/{repo_id}", response_model=CommitActivityResponse)
async def get_commit_activity(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    Get cached commit activity for a repository.
    Returns 404 if not yet fetched.
    """
    repo = get_repo_or_404(repo_id, db)

    activities = db.query(CommitActivity).filter(
        CommitActivity.repo_id == repo_id
    ).all()

    if not activities:
        raise HTTPException(
            status_code=404,
            detail="Commit activity not fetched yet. Use POST /fetch to retrieve from GitHub."
        )

    return _build_response(repo, activities)


@router.post("/{repo_id}/fetch", response_model=CommitActivityResponse)
async def fetch_commit_activity(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    Fetch (or refresh) commit activity from GitHub.
    Replaces existing cached data.
    """
    repo = get_repo_or_404(repo_id, db)

    try:
        service = get_github_service()
        github_data = await service.get_commit_activity(repo.owner, repo.name)

        if not github_data:
            # GitHub may return empty for new repos
            return CommitActivityResponse(
                repo_id=repo.id,
                repo_name=repo.full_name,
                weeks=[],
                total_commits_52w=0,
                avg_commits_per_week=0.0,
                last_updated=utc_now(),
            )

        activities = _store_commit_activity(db, repo_id, github_data)
        return _build_response(repo, activities)

    except GitHubNotFoundError:
        raise HTTPException(status_code=404, detail=f"Repository not found on GitHub: {repo.full_name}")
    except GitHubRateLimitError:
        raise HTTPException(status_code=429, detail="GitHub API rate limit exceeded. Please try again later.")
    except GitHubAPIError as e:
        raise HTTPException(status_code=502, detail=f"GitHub API error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{ERROR_FETCH_FAILED}: {str(e)}")


@router.get("/{repo_id}/summary", response_model=CommitActivitySummary)
async def get_commit_activity_summary(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    Get brief commit activity summary (for badges/cards).
    """
    get_repo_or_404(repo_id, db)

    # Aggregate in database for efficiency
    result = db.query(
        func.sum(CommitActivity.commit_count).label("total"),
        func.count(CommitActivity.id).label("weeks"),
        func.max(CommitActivity.fetched_at).label("last_updated"),
    ).filter(CommitActivity.repo_id == repo_id).first()

    if not result or result.total is None:
        raise HTTPException(
            status_code=404,
            detail="Commit activity not fetched yet"
        )

    total = result.total or 0
    weeks = result.weeks or 1
    avg = total / weeks if weeks > 0 else 0.0

    return CommitActivitySummary(
        repo_id=repo_id,
        total_commits_52w=total,
        avg_commits_per_week=round(avg, 2),
        last_updated=result.last_updated,
    )
