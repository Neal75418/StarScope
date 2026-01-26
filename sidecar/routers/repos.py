"""
Watchlist API endpoints for managing GitHub repositories.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import List, Optional, Dict
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import desc

from db import get_db, Repo, RepoSnapshot
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
from services.rate_limiter import fetch_repo_with_retry
from services.queries import build_signal_map, build_snapshot_map
from utils.time import utc_now, utc_today

import logging

logger = logging.getLogger(__name__)

# Error message constants
ERROR_REPO_NOT_FOUND = "Repository not found"

router = APIRouter()


def _get_repo_or_404(repo_id: int, db: Session) -> Repo:
    """Get repo by ID or raise 404."""
    repo = db.query(Repo).filter(Repo.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail=ERROR_REPO_NOT_FOUND)
    return repo


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


def _build_repo_with_signals(
    repo: Repo,
    snapshot: Optional[RepoSnapshot],
    signals: Dict[str, float | int]
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
    snapshot_map = build_snapshot_map(db, [repo.id])
    signal_map = build_signal_map(db, [repo.id])

    return _build_repo_with_signals(
        repo,
        snapshot_map.get(repo.id),
        signal_map.get(repo.id, {})
    )


def _update_repo_metadata(repo: Repo, github_data: Dict) -> None:
    """Update repo metadata from GitHub API response."""
    repo.description = github_data.get("description")
    repo.language = github_data.get("language")
    repo.updated_at = utc_now()


def _create_or_update_snapshot(repo: Repo, github_data: Dict, db: Session) -> None:
    """Create or update today's snapshot for a repo."""
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


def _build_repo_list_response(db: Session) -> RepoListResponse:
    """Build RepoListResponse with all repos and their signals."""
    repos = db.query(Repo).order_by(desc(Repo.added_at)).all()
    if not repos:
        return RepoListResponse(repos=[], total=0)

    repo_ids: List[int] = [r.id for r in repos]
    snapshot_map = build_snapshot_map(db, repo_ids)
    signal_map = build_signal_map(db, repo_ids)

    repos_with_signals = [
        _build_repo_with_signals(
            repo,
            snapshot_map.get(int(repo.id)),
            signal_map.get(int(repo.id), {})
        )
        for repo in repos
    ]

    return RepoListResponse(repos=repos_with_signals, total=len(repos))


@router.get("/repos", response_model=RepoListResponse)
async def list_repos(db: Session = Depends(get_db)) -> RepoListResponse:
    """
    List all repositories in the watchlist with their latest signals.
    Uses batch queries to avoid N+1 problem.
    """
    return _build_repo_list_response(db)


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
    repo = _get_repo_or_404(repo_id, db)
    return get_repo_with_signals(repo, db)


@router.delete("/repos/{repo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_repo(repo_id: int, db: Session = Depends(get_db)):
    """
    Remove a repository from the watchlist.
    This also deletes all associated snapshots and signals.
    """
    repo = _get_repo_or_404(repo_id, db)
    db.delete(repo)
    db.commit()
    return None


@router.post("/repos/{repo_id}/fetch", response_model=RepoWithSignals)
async def fetch_repo(repo_id: int, db: Session = Depends(get_db)) -> RepoWithSignals:
    """
    Manually fetch the latest data for a repository.
    Creates a new snapshot and recalculates signals.
    """
    repo = _get_repo_or_404(repo_id, db)

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

    # Update repo metadata and create/update snapshot
    _update_repo_metadata(repo, github_data)
    _create_or_update_snapshot(repo, github_data, db)
    db.commit()

    # Recalculate signals
    from services.analyzer import calculate_signals
    calculate_signals(repo.id, db)

    return get_repo_with_signals(repo, db)


@router.post("/repos/fetch-all", response_model=RepoListResponse)
async def fetch_all_repos(db: Session = Depends(get_db)) -> RepoListResponse:
    """
    Fetch the latest data for all repositories in the watchlist.
    Uses exponential backoff with retry for rate limit handling.
    """
    repos = db.query(Repo).all()
    github = GitHubService()

    for repo in repos:
        try:
            # Use retry wrapper with exponential backoff
            github_data = await fetch_repo_with_retry(github, repo.owner, repo.name)

            # Update repo metadata and create/update snapshot
            _update_repo_metadata(repo, github_data)
            _create_or_update_snapshot(repo, github_data, db)

            # Recalculate signals
            from services.analyzer import calculate_signals
            calculate_signals(repo.id, db)

        except GitHubNotFoundError:
            logger.warning(f"Repository {repo.full_name} not found on GitHub, skipping")
            continue
        except GitHubAPIError as e:
            # Covers GitHubRateLimitError and other API errors after retries exhausted
            logger.error(f"GitHub API error for {repo.full_name} after retries: {e}")
            continue

    db.commit()

    # Return updated list
    return _build_repo_list_response(db)
