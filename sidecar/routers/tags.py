"""
Tags API endpoints.
Provides auto-tagging and tag management for repositories.
"""

from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Repo, Tag, RepoTag, TagType
from services.tagger import get_tagger_service, auto_tag_repo, auto_tag_all_repos

router = APIRouter(prefix="/tags", tags=["tags"])


# Response schemas
class TagResponse(BaseModel):
    """Schema for a tag."""
    id: int
    name: str
    type: str
    color: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class RepoTagResponse(BaseModel):
    """Schema for a tag applied to a repo."""
    id: int
    name: str
    type: str
    color: Optional[str]
    source: str
    confidence: Optional[float]
    applied_at: Optional[datetime]


class TagListResponse(BaseModel):
    """Response for tag list."""
    tags: List[TagResponse]
    total: int


class RepoTagsResponse(BaseModel):
    """Response for repo tags."""
    repo_id: int
    tags: List[RepoTagResponse]
    total: int


class AutoTagResponse(BaseModel):
    """Response for auto-tag operation."""
    repo_id: int
    tags_applied: List[dict]
    total_applied: int


class AutoTagAllResponse(BaseModel):
    """Response for auto-tag all operation."""
    total_repos: int
    repos_tagged: int
    tags_applied: int


class AddTagRequest(BaseModel):
    """Request to add a custom tag."""
    name: str
    color: Optional[str] = None


class SearchByTagsResponse(BaseModel):
    """Response for search by tags."""
    repos: List[dict]
    total: int


# Helper functions
def _tag_to_response(tag: Tag) -> TagResponse:
    """Convert Tag model to response."""
    return TagResponse(
        id=tag.id,
        name=tag.name,
        type=tag.tag_type,
        color=tag.color,
        created_at=tag.created_at,
    )


def _repo_tag_to_response(repo_tag: RepoTag) -> RepoTagResponse:
    """Convert RepoTag to response."""
    return RepoTagResponse(
        id=repo_tag.tag.id,
        name=repo_tag.tag.name,
        type=repo_tag.tag.tag_type,
        color=repo_tag.tag.color,
        source=repo_tag.source,
        confidence=repo_tag.confidence,
        applied_at=repo_tag.applied_at,
    )


# Endpoints
@router.get("/", response_model=TagListResponse)
async def list_tags(
    tag_type: Optional[str] = Query(None, description="Filter by tag type (language, topic, inferred, custom)"),
    db: Session = Depends(get_db)
):
    """
    List all tags in the system.
    Optionally filter by tag type.
    """
    query = db.query(Tag)

    if tag_type:
        if tag_type not in [TagType.LANGUAGE, TagType.TOPIC, TagType.INFERRED, TagType.CUSTOM]:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid tag type. Must be one of: language, topic, inferred, custom"
            )
        query = query.filter(Tag.tag_type == tag_type)

    tags = query.order_by(Tag.name).all()

    return TagListResponse(
        tags=[_tag_to_response(t) for t in tags],
        total=len(tags),
    )


@router.get("/repo/{repo_id}", response_model=RepoTagsResponse)
async def get_repo_tags(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    Get all tags for a specific repository.
    """
    repo = db.query(Repo).filter(Repo.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    repo_tags = db.query(RepoTag).filter(RepoTag.repo_id == repo_id).all()

    return RepoTagsResponse(
        repo_id=repo_id,
        tags=[_repo_tag_to_response(rt) for rt in repo_tags],
        total=len(repo_tags),
    )


@router.post("/repo/{repo_id}", response_model=RepoTagsResponse)
async def add_tag_to_repo(
    repo_id: int,
    request: AddTagRequest,
    db: Session = Depends(get_db)
):
    """
    Add a custom tag to a repository.
    Creates the tag if it doesn't exist.
    """
    repo = db.query(Repo).filter(Repo.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    tagger = get_tagger_service()
    result = tagger.add_custom_tag(repo_id, request.name, request.color, db)

    if result is None:
        raise HTTPException(
            status_code=409,
            detail=f"Tag '{request.name}' is already applied to this repository"
        )

    repo_tags = db.query(RepoTag).filter(RepoTag.repo_id == repo_id).all()

    return RepoTagsResponse(
        repo_id=repo_id,
        tags=[_repo_tag_to_response(rt) for rt in repo_tags],
        total=len(repo_tags),
    )


@router.delete("/repo/{repo_id}/{tag_id}")
async def remove_tag_from_repo(
    repo_id: int,
    tag_id: int,
    db: Session = Depends(get_db)
):
    """
    Remove a tag from a repository.
    """
    repo = db.query(Repo).filter(Repo.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    tagger = get_tagger_service()
    removed = tagger.remove_tag(repo_id, tag_id, db)

    if not removed:
        raise HTTPException(status_code=404, detail="Tag is not applied to this repository")

    return {"status": "ok", "message": f"Tag '{tag.name}' removed from repository"}


@router.post("/repo/{repo_id}/auto-tag", response_model=AutoTagResponse)
async def trigger_auto_tag(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    Trigger auto-tagging for a specific repository.
    Fetches GitHub topics and analyzes description.
    """
    repo = db.query(Repo).filter(Repo.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    tags_applied = await auto_tag_repo(repo_id, db)

    return AutoTagResponse(
        repo_id=repo_id,
        tags_applied=tags_applied,
        total_applied=len(tags_applied),
    )


@router.post("/auto-tag-all", response_model=AutoTagAllResponse)
async def trigger_auto_tag_all(
    db: Session = Depends(get_db)
):
    """
    Trigger auto-tagging for all repositories in the watchlist.
    """
    result = await auto_tag_all_repos(db)

    return AutoTagAllResponse(
        total_repos=result["total_repos"],
        repos_tagged=result["repos_tagged"],
        tags_applied=result["tags_applied"],
    )


@router.get("/search", response_model=SearchByTagsResponse)
async def search_by_tags(
    tags: str = Query(..., description="Comma-separated list of tag names to search"),
    match_all: bool = Query(False, description="If true, repos must have ALL tags; otherwise ANY tag"),
    db: Session = Depends(get_db)
):
    """
    Find repositories matching the given tags.
    """
    tag_names = [t.strip().lower() for t in tags.split(",") if t.strip()]

    if not tag_names:
        raise HTTPException(status_code=400, detail="At least one tag name is required")

    if match_all:
        # Find repos that have ALL specified tags
        # Start with repos that have the first tag
        base_query = db.query(RepoTag.repo_id).join(Tag).filter(
            Tag.name.in_(tag_names)
        ).group_by(RepoTag.repo_id).having(
            db.query(Tag).filter(Tag.name.in_(tag_names)).count() == len(tag_names)
        )
        repo_ids = [r[0] for r in base_query.all()]
    else:
        # Find repos that have ANY of the specified tags
        repo_ids = [
            r[0] for r in db.query(RepoTag.repo_id).join(Tag).filter(
                Tag.name.in_(tag_names)
            ).distinct().all()
        ]

    repos = db.query(Repo).filter(Repo.id.in_(repo_ids)).all()

    result = []
    for repo in repos:
        repo_tags = db.query(RepoTag).filter(RepoTag.repo_id == repo.id).all()
        result.append({
            "id": repo.id,
            "full_name": repo.full_name,
            "description": repo.description,
            "language": repo.language,
            "tags": [{"name": rt.tag.name, "type": rt.tag.tag_type} for rt in repo_tags],
        })

    return SearchByTagsResponse(
        repos=result,
        total=len(result),
    )
