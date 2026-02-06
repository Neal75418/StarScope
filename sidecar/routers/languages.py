"""
Repo 程式語言 API 端點。
提供 repo 的程式語言分佈資料。
"""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Repo, RepoLanguage
from routers.dependencies import get_repo_or_404
from services.github import get_github_service
from utils.time import utc_now

router = APIRouter(prefix="/languages", tags=["languages"])


# 回應 schema
class LanguageBreakdown(BaseModel):
    """單一語言項目。"""
    language: str
    bytes: int
    percentage: float


class LanguagesResponse(BaseModel):
    """語言回應，含計算後的百分比。"""
    repo_id: int
    repo_name: str
    languages: List[LanguageBreakdown]
    primary_language: Optional[str]
    total_bytes: int
    last_updated: Optional[datetime]


class LanguagesSummary(BaseModel):
    """徽章/卡片用的簡短摘要。"""
    repo_id: int
    primary_language: Optional[str]
    language_count: int
    last_updated: Optional[datetime]


# 輔助函式
def _build_response(repo: Repo, languages: List[RepoLanguage]) -> LanguagesResponse:
    """從 repo 與語言紀錄建立 LanguagesResponse。"""
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
    儲存 GitHub API 回應中的語言資料。

    GitHub 回傳：{"Python": 123456, "JavaScript": 78901, ...}
    """
    # 刪除此 repo 的既有資料（替換策略）
    db.query(RepoLanguage).filter(RepoLanguage.repo_id == repo_id).delete()

    if not github_data:
        db.commit()
        return []

    # 計算百分比用的總位元組數
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


# 端點
@router.get("/{repo_id}", response_model=LanguagesResponse)
async def get_languages(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    取得 repo 的已快取語言資料。
    尚未抓取時回傳 404。
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
    從 GitHub 抓取（或重新整理）語言資料。
    取代既有的快取資料。
    """
    repo = get_repo_or_404(repo_id, db)

    # GitHub 例外由 main.py 中的全域例外處理器處理。
    service = get_github_service()
    github_data = await service.get_languages(repo.owner, repo.name)

    languages = _store_languages(db, repo_id, github_data)
    return _build_response(repo, languages)


@router.get("/{repo_id}/summary", response_model=LanguagesSummary)
async def get_languages_summary(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    取得簡短的語言摘要（用於徽章/卡片）。
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
