"""
Watchlist API endpoints for managing GitHub repositories.
"""

import re
from datetime import datetime
from typing import List, Optional, Dict
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import desc, func

from db import get_db, Repo, RepoSnapshot, Signal
from db.models import SignalType
from schemas import RepoCreate, RepoWithSignals, RepoListResponse
from constants import (
    GITHUB_USERNAME_PATTERN,
    GITHUB_REPO_NAME_PATTERN,
    MAX_OWNER_LENGTH,
    MAX_REPO_NAME_LENGTH,
)
from services.github import (
    GitHubService,
    GitHubAPIError,
    GitHubNotFoundError,
    GitHubRateLimitError,
)
from utils.time import utc_now, utc_today

import logging

logger = logging.getLogger(__name__)

router = APIRouter()


def _validate_github_identifier(owner: str, name: str) -> None:
    """
    Validate GitHub owner and repo name to prevent SSRF attacks.
    Raises HTTPException if validation fails.
    """
    # Check lengths
    if len(owner) > MAX_OWNER_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Owner name too long (max {MAX_OWNER_LENGTH} characters)"
        )
    if len(name) > MAX_REPO_NAME_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Repository name too long (max {MAX_REPO_NAME_LENGTH} characters)"
        )

    # Validate owner format (GitHub username pattern)
    if not re.match(GITHUB_USERNAME_PATTERN, owner):
        raise HTTPException(
            status_code=400,
            detail="Invalid GitHub username format"
        )

    # Validate repo name format
    if not re.match(GITHUB_REPO_NAME_PATTERN, name):
        raise HTTPException(
            status_code=400,
            detail="Invalid repository name format"
        )


def _build_snapshot_map(db: Session, repo_ids: List[int]) -> Dict[int, RepoSnapshot]:
    """
    Pre-fetch latest snapshots for multiple repos in a single query.
    Returns: {repo_id: RepoSnapshot}
    """
    if not repo_ids:
        return {}

    # Subquery to get max snapshot_date per repo
    subq = (
        db.query(
            RepoSnapshot.repo_id,
            func.max(RepoSnapshot.snapshot_date).label("max_date")
        )
        .filter(RepoSnapshot.repo_id.in_(repo_ids))
        .group_by(RepoSnapshot.repo_id)
        .subquery()
    )

    # Join to get full snapshot records
    snapshots = (
        db.query(RepoSnapshot)
        .join(
            subq,
            (RepoSnapshot.repo_id == subq.c.repo_id) &
            (RepoSnapshot.snapshot_date == subq.c.max_date)
        )
        .all()
    )

    return {s.repo_id: s for s in snapshots}


def _build_signal_map(db: Session, repo_ids: List[int]) -> Dict[int, Dict[str, float]]:
    """
    Pre-fetch all signals for multiple repos in a single query.
    Returns: {repo_id: {signal_type: value}}
    """
    if not repo_ids:
        return {}

    all_signals = (
        db.query(Signal)
        .filter(Signal.repo_id.in_(repo_ids))
        .all()
    )

    signal_map: Dict[int, Dict[str, float]] = {}
    for signal in all_signals:
        if signal.repo_id not in signal_map:
            signal_map[signal.repo_id] = {}
        signal_map[signal.repo_id][signal.signal_type] = signal.value

    return signal_map


def _build_repo_with_signals(
    repo: Repo,
    snapshot: Optional[RepoSnapshot],
    signals: Dict[str, float]
) -> RepoWithSignals:
    """Build a RepoWithSignals response from pre-fetched data."""
    return RepoWithSignals(
        id=repo.id,
        owner=repo.owner,
        name=repo.name,
        full_name=repo.full_name,
        url=repo.url,
        description=repo.description,
        language=repo.language,
        added_at=repo.added_at,
        updated_at=repo.updated_at,
        stars=snapshot.stars if snapshot else None,
        forks=snapshot.forks if snapshot else None,
        stars_delta_7d=signals.get(SignalType.STARS_DELTA_7D),
        stars_delta_30d=signals.get(SignalType.STARS_DELTA_30D),
        velocity=signals.get(SignalType.VELOCITY),
        acceleration=signals.get(SignalType.ACCELERATION),
        trend=int(signals.get(SignalType.TREND, 0)) if SignalType.TREND in signals else None,
        last_fetched=snapshot.fetched_at if snapshot else None,
    )


def get_repo_with_signals(repo: Repo, db: Session) -> RepoWithSignals:
    """
    Build a RepoWithSignals response from a Repo model.
    For single repo lookup - uses individual queries.
    """
    snapshot_map = _build_snapshot_map(db, [repo.id])
    signal_map = _build_signal_map(db, [repo.id])

    return _build_repo_with_signals(
        repo,
        snapshot_map.get(repo.id),
        signal_map.get(repo.id, {})
    )


@router.get("/repos", response_model=RepoListResponse)
async def list_repos(db: Session = Depends(get_db)) -> RepoListResponse:
    """
    List all repositories in the watchlist with their latest signals.
    Uses batch queries to avoid N+1 problem.
    """
    repos = db.query(Repo).order_by(desc(Repo.added_at)).all()

    if not repos:
        return RepoListResponse(repos=[], total=0)

    # Batch fetch all related data (3 queries total instead of 2N+1)
    repo_ids = [r.id for r in repos]
    snapshot_map = _build_snapshot_map(db, repo_ids)
    signal_map = _build_signal_map(db, repo_ids)

    # Build responses
    repos_with_signals = [
        _build_repo_with_signals(
            repo,
            snapshot_map.get(repo.id),
            signal_map.get(repo.id, {})
        )
        for repo in repos
    ]

    return RepoListResponse(
        repos=repos_with_signals,
        total=len(repos),
    )


@router.post("/repos", response_model=RepoWithSignals, status_code=status.HTTP_201_CREATED)
async def add_repo(repo_input: RepoCreate, db: Session = Depends(get_db)) -> RepoWithSignals:
    """
    Add a new repository to the watchlist.
    Can provide either owner+name or a GitHub URL.
    """
    try:
        owner, name = repo_input.get_owner_name()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Validate input to prevent SSRF
    _validate_github_identifier(owner, name)

    full_name = f"{owner}/{name}"

    # Check if already exists
    existing = db.query(Repo).filter(Repo.full_name == full_name).first()
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Repository {full_name} is already in your watchlist"
        )

    # Fetch repo info from GitHub
    github = GitHubService()
    try:
        github_data = await github.get_repo(owner, name)
    except GitHubNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=f"Repository {full_name} not found on GitHub"
        )
    except GitHubRateLimitError:
        raise HTTPException(
            status_code=429,
            detail="GitHub API rate limit exceeded. Please try again later."
        )
    except GitHubAPIError as e:
        raise HTTPException(
            status_code=502,
            detail=f"GitHub API error: {str(e)}"
        )

    # Create repo record
    repo = Repo(
        owner=owner,
        name=name,
        full_name=full_name,
        url=f"https://github.com/{full_name}",
        description=github_data.get("description"),
        github_id=github_data.get("id"),
        default_branch=github_data.get("default_branch"),
        language=github_data.get("language"),
        created_at=datetime.fromisoformat(github_data["created_at"].replace("Z", "+00:00")) if github_data.get("created_at") else None,
    )
    db.add(repo)
    db.commit()
    db.refresh(repo)

    # Create initial snapshot
    snapshot = RepoSnapshot(
        repo_id=repo.id,
        stars=github_data.get("stargazers_count", 0),
        forks=github_data.get("forks_count", 0),
        watchers=github_data.get("watchers_count", 0),
        open_issues=github_data.get("open_issues_count", 0),
        snapshot_date=utc_today(),
    )
    db.add(snapshot)
    db.commit()

    return get_repo_with_signals(repo, db)


@router.get("/repos/{repo_id}", response_model=RepoWithSignals)
async def get_repo(repo_id: int, db: Session = Depends(get_db)) -> RepoWithSignals:
    """
    Get a single repository by ID with its signals.
    """
    repo = db.query(Repo).filter(Repo.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    return get_repo_with_signals(repo, db)


@router.delete("/repos/{repo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_repo(repo_id: int, db: Session = Depends(get_db)):
    """
    Remove a repository from the watchlist.
    This also deletes all associated snapshots and signals.
    """
    repo = db.query(Repo).filter(Repo.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    db.delete(repo)
    db.commit()
    return None


@router.post("/repos/{repo_id}/fetch", response_model=RepoWithSignals)
async def fetch_repo(repo_id: int, db: Session = Depends(get_db)) -> RepoWithSignals:
    """
    Manually fetch the latest data for a repository.
    Creates a new snapshot and recalculates signals.
    """
    repo = db.query(Repo).filter(Repo.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    # Fetch from GitHub
    github = GitHubService()
    try:
        github_data = await github.get_repo(repo.owner, repo.name)
    except GitHubNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=f"Repository {repo.full_name} no longer exists on GitHub"
        )
    except GitHubRateLimitError:
        raise HTTPException(
            status_code=429,
            detail="GitHub API rate limit exceeded. Please try again later."
        )
    except GitHubAPIError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch from GitHub: {str(e)}"
        )

    # Update repo metadata
    repo.description = github_data.get("description")
    repo.language = github_data.get("language")
    repo.updated_at = utc_now()

    # Check if we already have a snapshot for today
    today = utc_today()
    existing_snapshot = (
        db.query(RepoSnapshot)
        .filter(RepoSnapshot.repo_id == repo.id, RepoSnapshot.snapshot_date == today)
        .first()
    )

    if existing_snapshot:
        # Update existing snapshot
        existing_snapshot.stars = github_data.get("stargazers_count", 0)
        existing_snapshot.forks = github_data.get("forks_count", 0)
        existing_snapshot.watchers = github_data.get("watchers_count", 0)
        existing_snapshot.open_issues = github_data.get("open_issues_count", 0)
        existing_snapshot.fetched_at = utc_now()
    else:
        # Create new snapshot
        snapshot = RepoSnapshot(
            repo_id=repo.id,
            stars=github_data.get("stargazers_count", 0),
            forks=github_data.get("forks_count", 0),
            watchers=github_data.get("watchers_count", 0),
            open_issues=github_data.get("open_issues_count", 0),
            snapshot_date=today,
        )
        db.add(snapshot)

    db.commit()

    # Recalculate signals (will be implemented in Step 3)
    from services.analyzer import calculate_signals
    calculate_signals(repo.id, db)

    return get_repo_with_signals(repo, db)


@router.post("/repos/fetch-all", response_model=RepoListResponse)
async def fetch_all_repos(db: Session = Depends(get_db)) -> RepoListResponse:
    """
    Fetch the latest data for all repositories in the watchlist.
    """
    repos = db.query(Repo).all()
    github = GitHubService()

    for repo in repos:
        try:
            github_data = await github.get_repo(repo.owner, repo.name)

            # Update repo metadata
            repo.description = github_data.get("description")
            repo.language = github_data.get("language")
            repo.updated_at = utc_now()

            # Create or update snapshot
            today = utc_today()
            existing_snapshot = (
                db.query(RepoSnapshot)
                .filter(RepoSnapshot.repo_id == repo.id, RepoSnapshot.snapshot_date == today)
                .first()
            )

            if existing_snapshot:
                existing_snapshot.stars = github_data.get("stargazers_count", 0)
                existing_snapshot.forks = github_data.get("forks_count", 0)
                existing_snapshot.watchers = github_data.get("watchers_count", 0)
                existing_snapshot.open_issues = github_data.get("open_issues_count", 0)
                existing_snapshot.fetched_at = utc_now()
            else:
                snapshot = RepoSnapshot(
                    repo_id=repo.id,
                    stars=github_data.get("stargazers_count", 0),
                    forks=github_data.get("forks_count", 0),
                    watchers=github_data.get("watchers_count", 0),
                    open_issues=github_data.get("open_issues_count", 0),
                    snapshot_date=today,
                )
                db.add(snapshot)

            # Recalculate signals
            from services.analyzer import calculate_signals
            calculate_signals(repo.id, db)

        except GitHubNotFoundError:
            logger.warning(f"Repository {repo.full_name} not found on GitHub, skipping")
            continue
        except GitHubRateLimitError:
            logger.error("GitHub rate limit exceeded, stopping batch fetch")
            break  # Stop processing when rate limited
        except GitHubAPIError as e:
            logger.error(f"GitHub API error for {repo.full_name}: {e}")
            continue
        except Exception as e:
            logger.error(f"Unexpected error fetching {repo.full_name}: {e}")
            continue

    db.commit()

    # Return updated list (using batch queries)
    repos = db.query(Repo).order_by(desc(Repo.added_at)).all()
    if not repos:
        return RepoListResponse(repos=[], total=0)

    repo_ids = [r.id for r in repos]
    snapshot_map = _build_snapshot_map(db, repo_ids)
    signal_map = _build_signal_map(db, repo_ids)

    repos_with_signals = [
        _build_repo_with_signals(repo, snapshot_map.get(repo.id), signal_map.get(repo.id, {}))
        for repo in repos
    ]

    return RepoListResponse(
        repos=repos_with_signals,
        total=len(repos),
    )
