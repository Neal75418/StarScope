"""
推薦 API 端點。
基於 topics 與語言提供相似 repo 推薦。
"""

from fastapi import APIRouter, Depends, Query, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from middleware.rate_limit import limiter

from db.database import get_db
from db.models import Repo
from services.recommender import (
    calculate_repo_similarities,
    recalculate_all_similarities,
    get_personalized_recommendations,
)
from schemas.response import ApiResponse, success_response

router = APIRouter(prefix="/api/recommendations", tags=["recommendations"])


class CalculateSimilaritiesResponse(BaseModel):
    """計算相似度操作的回應。"""
    repo_id: int
    similarities_found: int


class RecalculateAllResponse(BaseModel):
    """重新計算全部操作的回應。"""
    total_repos: int
    processed: int
    similarities_found: int


class PersonalizedRecommendation(BaseModel):
    """個人化推薦 repo 的 schema。"""
    repo_id: int
    full_name: str
    description: str | None
    language: str | None
    url: str
    stars: int | None
    velocity: float | None
    trend: int | None
    similarity_score: float
    shared_topics: list[str]
    same_language: bool
    source_repo_id: int
    source_repo_name: str


class PersonalizedResponse(BaseModel):
    """個人化推薦列表的回應。"""
    recommendations: list[PersonalizedRecommendation]
    total: int
    based_on_repos: int


# 端點
@router.post("/repo/{repo_id}/calculate", response_model=ApiResponse[CalculateSimilaritiesResponse])
async def calculate_similarities_for_repo(
    repo_id: int,
    db: Session = Depends(get_db)
) -> dict:
    """
    計算（或重新計算）特定 repo 的相似度分數。
    與追蹤清單中的所有其他 repo 比較。
    """
    repo = db.query(Repo).filter(Repo.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    count = calculate_repo_similarities(repo_id, db)

    calc_response = CalculateSimilaritiesResponse(
        repo_id=repo_id,
        similarities_found=count,
    )

    return success_response(
        data=calc_response,
        message=f"Calculated {count} similarity pairs for repository {repo_id}"
    )


@router.post("/recalculate", response_model=ApiResponse[RecalculateAllResponse])
@limiter.limit("2/minute")
async def recalculate_all(
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    """
    重新計算追蹤清單中所有 repo 的相似度分數。
    對於大型追蹤清單，此操作可能較慢。
    """
    _ = request  # 由 @limiter.limit decorator 隱式使用
    result = recalculate_all_similarities(db)

    recalc_response = RecalculateAllResponse(
        total_repos=result["total_repos"],
        processed=result["processed"],
        similarities_found=result["similarities_found"],
    )

    return success_response(
        data=recalc_response,
        message=f"Recalculated similarities for {result['processed']} repositories"
    )


@router.get("/personalized", response_model=ApiResponse[PersonalizedResponse])
async def get_personalized(
    limit: int = Query(10, ge=1, le=50, description="Maximum number of recommendations"),
    db: Session = Depends(get_db)
) -> dict:
    """
    取得基於 watchlist 的個人化推薦。
    根據追蹤清單中所有 repo 的相似度，推薦尚未追蹤但值得關注的 repo。
    加入 velocity boost，讓成長中的 repo 排名更高。
    """
    result = get_personalized_recommendations(db, limit)

    personalized_response = PersonalizedResponse(
        recommendations=[
            PersonalizedRecommendation(**r) for r in result["recommendations"]
        ],
        total=result["total"],
        based_on_repos=result["based_on_repos"],
    )

    return success_response(
        data=personalized_response,
        message=f"Found {result['total']} personalized recommendations"
    )
