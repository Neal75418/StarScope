"""
Comparisons API endpoints.
Provides CRUD for comparison groups and comparison data generation.
"""

from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import ComparisonGroup, ComparisonMember, Repo
from services.comparison import get_comparison_service
from utils.time import utc_now

router = APIRouter(prefix="/comparisons", tags=["comparisons"])


# Request/Response schemas
class ComparisonGroupCreate(BaseModel):
    """Schema for creating a comparison group."""
    name: str
    description: Optional[str] = None


class ComparisonGroupUpdate(BaseModel):
    """Schema for updating a comparison group."""
    name: Optional[str] = None
    description: Optional[str] = None


class ComparisonGroupResponse(BaseModel):
    """Schema for a comparison group."""
    id: int
    name: str
    description: Optional[str]
    member_count: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ComparisonMemberResponse(BaseModel):
    """Schema for a member in a comparison."""
    repo_id: int
    full_name: str
    language: Optional[str]
    sort_order: int


class ComparisonGroupListResponse(BaseModel):
    """Response for comparison group list."""
    groups: List[ComparisonGroupResponse]
    total: int


# Helper functions
def _group_to_response(group: ComparisonGroup, db: Session) -> ComparisonGroupResponse:
    """Convert ComparisonGroup model to response."""
    member_count = db.query(ComparisonMember).filter(
        ComparisonMember.group_id == group.id
    ).count()

    return ComparisonGroupResponse(
        id=group.id,
        name=group.name,
        description=group.description,
        member_count=member_count,
        created_at=group.created_at,
        updated_at=group.updated_at,
    )


# Endpoints
@router.get("/", response_model=ComparisonGroupListResponse)
async def list_comparison_groups(
    db: Session = Depends(get_db)
):
    """
    List all comparison groups.
    """
    groups = db.query(ComparisonGroup).order_by(ComparisonGroup.updated_at.desc()).all()

    return ComparisonGroupListResponse(
        groups=[_group_to_response(g, db) for g in groups],
        total=len(groups),
    )


@router.get("/{group_id}")
async def get_comparison_group(
    group_id: int,
    db: Session = Depends(get_db)
):
    """
    Get a comparison group with full comparison data.
    """
    service = get_comparison_service()
    result = service.get_comparison_summary(group_id, db)

    if result is None:
        raise HTTPException(status_code=404, detail="Comparison group not found")

    return result


@router.post("/", response_model=ComparisonGroupResponse)
async def create_comparison_group(
    request: ComparisonGroupCreate,
    db: Session = Depends(get_db)
):
    """
    Create a new comparison group.
    """
    group = ComparisonGroup(
        name=request.name,
        description=request.description,
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    db.add(group)
    db.commit()
    db.refresh(group)

    return _group_to_response(group, db)


@router.put("/{group_id}", response_model=ComparisonGroupResponse)
async def update_comparison_group(
    group_id: int,
    request: ComparisonGroupUpdate,
    db: Session = Depends(get_db)
):
    """
    Update a comparison group.
    """
    group = db.query(ComparisonGroup).filter(ComparisonGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Comparison group not found")

    if request.name is not None:
        group.name = request.name
    if request.description is not None:
        group.description = request.description

    group.updated_at = utc_now()
    db.commit()
    db.refresh(group)

    return _group_to_response(group, db)


@router.delete("/{group_id}")
async def delete_comparison_group(
    group_id: int,
    db: Session = Depends(get_db)
):
    """
    Delete a comparison group.
    """
    group = db.query(ComparisonGroup).filter(ComparisonGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Comparison group not found")

    group_name = group.name
    db.delete(group)
    db.commit()

    return {"status": "ok", "message": f"Comparison group '{group_name}' deleted"}


@router.get("/{group_id}/members")
async def get_comparison_members(
    group_id: int,
    db: Session = Depends(get_db)
):
    """
    Get members of a comparison group.
    """
    group = db.query(ComparisonGroup).filter(ComparisonGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Comparison group not found")

    members = db.query(ComparisonMember).filter(
        ComparisonMember.group_id == group_id
    ).order_by(ComparisonMember.sort_order).all()

    return {
        "group_id": group_id,
        "group_name": group.name,
        "members": [
            {
                "repo_id": m.repo.id,
                "full_name": m.repo.full_name,
                "language": m.repo.language,
                "sort_order": m.sort_order,
            }
            for m in members
        ],
        "total": len(members),
    }


@router.post("/{group_id}/repos/{repo_id}")
async def add_repo_to_comparison(
    group_id: int,
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    Add a repository to a comparison group.
    """
    group = db.query(ComparisonGroup).filter(ComparisonGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Comparison group not found")

    repo = db.query(Repo).filter(Repo.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    # Check if already in group
    existing = db.query(ComparisonMember).filter(
        ComparisonMember.group_id == group_id,
        ComparisonMember.repo_id == repo_id
    ).first()

    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Repository is already in comparison group '{group.name}'"
        )

    # Get next sort order
    max_order = db.query(ComparisonMember.sort_order).filter(
        ComparisonMember.group_id == group_id
    ).order_by(ComparisonMember.sort_order.desc()).first()
    next_order = (max_order[0] + 1) if max_order else 0

    member = ComparisonMember(
        group_id=group_id,
        repo_id=repo_id,
        sort_order=next_order,
        added_at=utc_now(),
    )
    db.add(member)

    group.updated_at = utc_now()
    db.commit()

    return {
        "status": "ok",
        "message": f"Repository '{repo.full_name}' added to comparison group '{group.name}'"
    }


@router.delete("/{group_id}/repos/{repo_id}")
async def remove_repo_from_comparison(
    group_id: int,
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    Remove a repository from a comparison group.
    """
    group = db.query(ComparisonGroup).filter(ComparisonGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Comparison group not found")

    member = db.query(ComparisonMember).filter(
        ComparisonMember.group_id == group_id,
        ComparisonMember.repo_id == repo_id
    ).first()

    if not member:
        raise HTTPException(status_code=404, detail="Repository is not in this comparison group")

    repo_name = member.repo.full_name
    db.delete(member)

    group.updated_at = utc_now()
    db.commit()

    return {
        "status": "ok",
        "message": f"Repository '{repo_name}' removed from comparison group '{group.name}'"
    }


@router.get("/{group_id}/chart")
async def get_comparison_chart_data(
    group_id: int,
    time_range: str = Query("30d", regex="^(7d|30d|90d)$"),
    db: Session = Depends(get_db)
):
    """
    Get chart data for comparing repos over time.
    """
    service = get_comparison_service()
    result = service.get_comparison_chart_data(group_id, db, time_range)

    if result is None:
        raise HTTPException(status_code=404, detail="Comparison group not found")

    return result


@router.get("/{group_id}/velocity")
async def get_velocity_comparison(
    group_id: int,
    db: Session = Depends(get_db)
):
    """
    Get velocity comparison data for bar charts.
    """
    service = get_comparison_service()
    result = service.get_velocity_comparison(group_id, db)

    if result is None:
        raise HTTPException(status_code=404, detail="Comparison group not found")

    return result
