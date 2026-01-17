"""
Watchlist API endpoints for managing GitHub repositories.
"""

from datetime import datetime, date
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import desc

from db import get_db, Repo, RepoSnapshot, Signal
from db.models import SignalType
from schemas import RepoCreate, RepoResponse, RepoWithSignals, RepoListResponse
from services.github import GitHubService

router = APIRouter()


def get_repo_with_signals(repo: Repo, db: Session) -> RepoWithSignals:
    """
    Build a RepoWithSignals response from a Repo model.
    Includes latest snapshot data and signals.
    """
    # Get latest snapshot
    latest_snapshot = (
        db.query(RepoSnapshot)
        .filter(RepoSnapshot.repo_id == repo.id)
        .order_by(desc(RepoSnapshot.snapshot_date))
        .first()
    )

    # Get latest signals
    signals = (
        db.query(Signal)
        .filter(Signal.repo_id == repo.id)
        .all()
    )
    signal_map = {s.signal_type: s.value for s in signals}

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
        stars=latest_snapshot.stars if latest_snapshot else None,
        forks=latest_snapshot.forks if latest_snapshot else None,
        stars_delta_7d=signal_map.get(SignalType.STARS_DELTA_7D),
        stars_delta_30d=signal_map.get(SignalType.STARS_DELTA_30D),
        velocity=signal_map.get(SignalType.VELOCITY),
        acceleration=signal_map.get(SignalType.ACCELERATION),
        trend=int(signal_map.get(SignalType.TREND, 0)) if SignalType.TREND in signal_map else None,
        last_fetched=latest_snapshot.fetched_at if latest_snapshot else None,
    )


@router.get("/repos", response_model=RepoListResponse)
async def list_repos(db: Session = Depends(get_db)) -> RepoListResponse:
    """
    List all repositories in the watchlist with their latest signals.
    """
    repos = db.query(Repo).order_by(desc(Repo.added_at)).all()
    repos_with_signals = [get_repo_with_signals(repo, db) for repo in repos]

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
    except Exception as e:
        raise HTTPException(
            status_code=404,
            detail=f"Repository {full_name} not found on GitHub: {str(e)}"
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
        snapshot_date=date.today(),
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
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch from GitHub: {str(e)}"
        )

    # Update repo metadata
    repo.description = github_data.get("description")
    repo.language = github_data.get("language")
    repo.updated_at = datetime.utcnow()

    # Check if we already have a snapshot for today
    today = date.today()
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
        existing_snapshot.fetched_at = datetime.utcnow()
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
            repo.updated_at = datetime.utcnow()

            # Create or update snapshot
            today = date.today()
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
                existing_snapshot.fetched_at = datetime.utcnow()
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

        except Exception as e:
            # Log error but continue with other repos
            print(f"Error fetching {repo.full_name}: {e}")
            continue

    db.commit()

    # Return updated list
    repos = db.query(Repo).order_by(desc(Repo.added_at)).all()
    repos_with_signals = [get_repo_with_signals(repo, db) for repo in repos]

    return RepoListResponse(
        repos=repos_with_signals,
        total=len(repos),
    )
