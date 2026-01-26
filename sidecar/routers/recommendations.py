"""
Recommendations API endpoints.
Provides similar repository recommendations based on topics and language.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Repo, SimilarRepo
from services.recommender import (
    find_similar_repos,
    calculate_repo_similarities,
    recalculate_all_similarities,
)

router = APIRouter(prefix="/recommendations", tags=["recommendations"])


# Response schemas
class SimilarRepoResponse(BaseModel):
    """Schema for a similar repo."""
    repo_id: int
    full_name: str
    description: Optional[str]
    language: Optional[str]
    url: str
    similarity_score: float
    shared_topics: List[str]
    same_language: bool


class SimilarReposResponse(BaseModel):
    """Response for similar repos list."""
    repo_id: int
    similar: List[SimilarRepoResponse]
    total: int


class CalculateSimilaritiesResponse(BaseModel):
    """Response for calculate similarities operation."""
    repo_id: int
    similarities_found: int


class RecalculateAllResponse(BaseModel):
    """Response for recalculate all operation."""
    total_repos: int
    processed: int
    similarities_found: int


# Endpoints
@router.get("/similar/{repo_id}", response_model=SimilarReposResponse)
async def get_similar_repos(
    repo_id: int,
    limit: int = Query(10, ge=1, le=50, description="Maximum number of similar repos to return"),
    db: Session = Depends(get_db)
):
    """
    Get similar repositories for a given repo.
    Returns repos from the watchlist that are most similar based on topics and language.
    """
    repo = db.query(Repo).filter(Repo.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    similar = find_similar_repos(repo_id, db, limit)

    return SimilarReposResponse(
        repo_id=repo_id,
        similar=[SimilarRepoResponse(**s) for s in similar],
        total=len(similar),
    )


@router.post("/repo/{repo_id}/calculate", response_model=CalculateSimilaritiesResponse)
async def calculate_similarities_for_repo(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    Calculate (or recalculate) similarity scores for a specific repository.
    Compares against all other repos in the watchlist.
    """
    repo = db.query(Repo).filter(Repo.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    count = calculate_repo_similarities(repo_id, db)

    return CalculateSimilaritiesResponse(
        repo_id=repo_id,
        similarities_found=count,
    )


@router.post("/recalculate", response_model=RecalculateAllResponse)
async def recalculate_all(
    db: Session = Depends(get_db)
):
    """
    Recalculate similarity scores for all repositories in the watchlist.
    This is a potentially slow operation for large watchlists.
    """
    result = recalculate_all_similarities(db)

    return RecalculateAllResponse(
        total_repos=result["total_repos"],
        processed=result["processed"],
        similarities_found=result["similarities_found"],
    )


@router.get("/stats")
async def get_recommendation_stats(
    db: Session = Depends(get_db)
):
    """
    Get statistics about the recommendation system.
    """
    total_repos = db.query(Repo).count()
    total_similarities = db.query(SimilarRepo).count()

    # Average similarity score
    from sqlalchemy import func
    avg_score = db.query(func.avg(SimilarRepo.similarity_score)).scalar() or 0.0

    # Repos with at least one similar repo
    repos_with_similar = db.query(SimilarRepo.repo_id).distinct().count()

    return {
        "total_repos": total_repos,
        "total_similarity_pairs": total_similarities,
        "repos_with_recommendations": repos_with_similar,
        "average_similarity_score": round(avg_score, 3),
    }
