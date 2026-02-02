"""
Repository Languages API endpoints.
Provides programming language breakdown data for repositories.
"""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Repo, RepoLanguage
from routers.dependencies import get_repo_or_404
from services.github import get_github_service, GitHubNotFoundError, GitHubRateLimitError, GitHubAPIError
from utils.time import utc_now

ERROR_FETCH_FAILED = "Failed to fetch languages from GitHub"

router = APIRouter(prefix="/languages", tags=["languages"])


# Response schemas
class LanguageBreakdown(BaseModel):
    """Single language entry."""
    language: str
    bytes: int
    percentage: float


class LanguagesResponse(BaseModel):
    """Languages response with calculated percentages."""
    repo_id: int
    repo_name: str
    languages: List[LanguageBreakdown]
    primary_language: Optional[str]
    total_bytes: int
    last_updated: Optional[datetime]


class LanguagesSummary(BaseModel):
    """Brief summary for badges/cards."""
    repo_id: int
    primary_language: Optional[str]
    language_count: int
    last_updated: Optional[datetime]


# Helper functions
def _build_response(repo: Repo, languages: List[RepoLanguage]) -> LanguagesResponse:
    """Build LanguagesResponse from repo and language records."""
    sorted_languages = sorted(languages, key=lambda x: x.bytes, reverse=True)

    breakdown = [
        LanguageBreakdown(
            language=lang.language,
            bytes=lang.bytes,
            percentage=lang.percentage,
        )
        for lang in sorted_languages
    ]

    total_bytes = sum(lang.bytes for lang in languages)
    primary = sorted_languages[0].language if sorted_languages else None
    last_updated = max((lang.updated_at for lang in languages), default=None) if languages else None

    return LanguagesResponse(
        repo_id=repo.id,
        repo_name=repo.full_name,
        languages=breakdown,
        primary_language=primary,
        total_bytes=total_bytes,
        last_updated=last_updated,
    )


def _store_languages(
    db: Session,
    repo_id: int,
    github_data: dict[str, int]
) -> List[RepoLanguage]:
    """
    Store languages data from GitHub API response.

    GitHub returns: {"Python": 123456, "JavaScript": 78901, ...}
    """
    # Delete existing data for this repo (replace strategy)
    db.query(RepoLanguage).filter(RepoLanguage.repo_id == repo_id).delete()

    if not github_data:
        db.commit()
        return []

    # Calculate total bytes for percentage
    total_bytes = sum(github_data.values())
    now = utc_now()

    languages = []
    for language, byte_count in github_data.items():
        percentage = (byte_count / total_bytes * 100) if total_bytes > 0 else 0.0
        lang_record = RepoLanguage(
            repo_id=repo_id,
            language=language,
            bytes=byte_count,
            percentage=round(percentage, 2),
            updated_at=now,
        )
        languages.append(lang_record)

    db.add_all(languages)
    db.commit()

    return languages


# Endpoints
@router.get("/{repo_id}", response_model=LanguagesResponse)
async def get_languages(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    Get cached languages for a repository.
    Returns 404 if not yet fetched.
    """
    repo = get_repo_or_404(repo_id, db)

    languages = db.query(RepoLanguage).filter(
        RepoLanguage.repo_id == repo_id
    ).all()

    if not languages:
        raise HTTPException(
            status_code=404,
            detail="Languages not fetched yet. Use POST /fetch to retrieve from GitHub."
        )

    return _build_response(repo, languages)


@router.post("/{repo_id}/fetch", response_model=LanguagesResponse)
async def fetch_languages(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    Fetch (or refresh) languages from GitHub.
    Replaces existing cached data.
    """
    repo = get_repo_or_404(repo_id, db)

    try:
        service = get_github_service()
        github_data = await service.get_languages(repo.owner, repo.name)

        languages = _store_languages(db, repo_id, github_data)
        return _build_response(repo, languages)

    except GitHubNotFoundError:
        raise HTTPException(status_code=404, detail=f"Repository not found on GitHub: {repo.full_name}")
    except GitHubRateLimitError:
        raise HTTPException(status_code=429, detail="GitHub API rate limit exceeded. Please try again later.")
    except GitHubAPIError as e:
        raise HTTPException(status_code=502, detail=f"GitHub API error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{ERROR_FETCH_FAILED}: {str(e)}")


@router.get("/{repo_id}/summary", response_model=LanguagesSummary)
async def get_languages_summary(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    Get brief languages summary (for badges/cards).
    """
    get_repo_or_404(repo_id, db)

    languages = db.query(RepoLanguage).filter(
        RepoLanguage.repo_id == repo_id
    ).order_by(RepoLanguage.bytes.desc()).all()

    if not languages:
        raise HTTPException(
            status_code=404,
            detail="Languages not fetched yet"
        )

    return LanguagesSummary(
        repo_id=repo_id,
        primary_language=languages[0].language if languages else None,
        language_count=len(languages),
        last_updated=max((lang.updated_at for lang in languages), default=None),
    )
