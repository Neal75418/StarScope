"""
推薦 API 端點。
基於 topics 與語言提供相似 repo 推薦。
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


# 回應 schema
class SimilarRepoResponse(BaseModel):
    """相似 repo 的 schema。"""
    repo_id: int
    full_name: str
    description: Optional[str]
    language: Optional[str]
    url: str
    similarity_score: float
    shared_topics: List[str]
    same_language: bool
    topic_score: Optional[float] = None
    language_score: Optional[float] = None
    magnitude_score: Optional[float] = None


class SimilarReposResponse(BaseModel):
    """相似 repo 列表的回應。"""
    repo_id: int
    similar: List[SimilarRepoResponse]
    total: int


class CalculateSimilaritiesResponse(BaseModel):
    """計算相似度操作的回應。"""
    repo_id: int
    similarities_found: int


class RecalculateAllResponse(BaseModel):
    """重新計算全部操作的回應。"""
    total_repos: int
    processed: int
    similarities_found: int


# 端點
@router.get("/similar/{repo_id}", response_model=SimilarReposResponse)
async def get_similar_repos(
    repo_id: int,
    limit: int = Query(10, ge=1, le=50, description="Maximum number of similar repos to return"),
    db: Session = Depends(get_db)
):
    """
    取得指定 repo 的相似 repo。
    回傳追蹤清單中基於 topics 與語言最相似的 repo。
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
    計算（或重新計算）特定 repo 的相似度分數。
    與追蹤清單中的所有其他 repo 比較。
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
    重新計算追蹤清單中所有 repo 的相似度分數。
    對於大型追蹤清單，此操作可能較慢。
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
    取得推薦系統的統計資訊。
    """
    total_repos = db.query(Repo).count()
    total_similarities = db.query(SimilarRepo).count()

    # 平均相似度分數
    from sqlalchemy import func
    avg_score = db.query(func.avg(SimilarRepo.similarity_score)).scalar() or 0.0

    # 至少有一個相似 repo 的 repo
    repos_with_similar = db.query(SimilarRepo.repo_id).distinct().count()

    return {
        "total_repos": total_repos,
        "total_similarity_pairs": total_similarities,
        "repos_with_recommendations": repos_with_similar,
        "average_similarity_score": round(avg_score, 3),
    }
