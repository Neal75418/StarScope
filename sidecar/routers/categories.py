"""
Categories API endpoints.
Provides CRUD operations for user-defined repository categories.
"""

from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Category, RepoCategory, Repo
from utils.time import utc_now

# Error message constants
ERROR_CATEGORY_NOT_FOUND = "Category not found"
ERROR_PARENT_CATEGORY_NOT_FOUND = "Parent category not found"
ERROR_REPO_NOT_FOUND = "Repository not found"
ERROR_CIRCULAR_REFERENCE = "Category cannot be its own parent"
ERROR_REPO_NOT_IN_CATEGORY = "Repository is not in this category"

router = APIRouter(prefix="/categories", tags=["categories"])


# Request/Response schemas
class CategoryCreate(BaseModel):
    """Schema for creating a category."""
    name: str
    description: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    parent_id: Optional[int] = None


class CategoryUpdate(BaseModel):
    """Schema for updating a category."""
    name: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    parent_id: Optional[int] = None
    sort_order: Optional[int] = None


class CategoryResponse(BaseModel):
    """Schema for a category."""
    id: int
    name: str
    description: Optional[str]
    icon: Optional[str]
    color: Optional[str]
    parent_id: Optional[int]
    sort_order: int
    created_at: datetime
    repo_count: int = 0

    class Config:
        from_attributes = True


class CategoryTreeNode(BaseModel):
    """Schema for a category in tree structure."""
    id: int
    name: str
    description: Optional[str]
    icon: Optional[str]
    color: Optional[str]
    sort_order: int
    repo_count: int
    children: List["CategoryTreeNode"] = []

    class Config:
        from_attributes = True


class CategoryListResponse(BaseModel):
    """Response for category list."""
    categories: List[CategoryResponse]
    total: int


class CategoryTreeResponse(BaseModel):
    """Response for category tree."""
    tree: List[CategoryTreeNode]
    total: int


class RepoCategoryResponse(BaseModel):
    """Schema for a repo in a category."""
    id: int
    full_name: str
    description: Optional[str]
    language: Optional[str]
    added_at: datetime


class CategoryReposResponse(BaseModel):
    """Response for repos in a category."""
    category_id: int
    category_name: str
    repos: List[RepoCategoryResponse]
    total: int


# Helper functions
def _get_repo_count(category_id: int, db: Session) -> int:
    """Get number of repos in a category."""
    return db.query(RepoCategory).filter(RepoCategory.category_id == category_id).count()


def _category_to_response(category: "Category", db: Session) -> CategoryResponse:
    """Convert Category model to response."""
    return CategoryResponse(
        id=category.id,
        name=category.name,
        description=category.description,
        icon=category.icon,
        color=category.color,
        parent_id=category.parent_id,
        sort_order=category.sort_order,
        created_at=category.created_at,
        repo_count=_get_repo_count(category.id, db),
    )


def _build_tree(categories: List["Category"], parent_id: Optional[int], db: Session) -> List[CategoryTreeNode]:
    """Build tree structure from flat category list."""
    nodes = []
    for cat in categories:
        if cat.parent_id == parent_id:
            children = _build_tree(categories, cat.id, db)
            node = CategoryTreeNode(
                id=cat.id,
                name=cat.name,
                description=cat.description,
                icon=cat.icon,
                color=cat.color,
                sort_order=cat.sort_order,
                repo_count=_get_repo_count(cat.id, db),
                children=children,
            )
            nodes.append(node)
    return sorted(nodes, key=lambda x: x.sort_order)


def _repo_category_to_response(rc: "RepoCategory") -> RepoCategoryResponse:
    """Convert RepoCategory model to RepoCategoryResponse."""
    return RepoCategoryResponse(
        id=rc.repo.id,
        full_name=rc.repo.full_name,
        description=rc.repo.description,
        language=rc.repo.language,
        added_at=rc.added_at,
    )


def _get_category_or_404(category_id: int, db: Session) -> "Category":
    """Get category by ID or raise 404."""
    category = db.query(Category).filter(Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail=ERROR_CATEGORY_NOT_FOUND)
    return category


def _get_repo_or_404(repo_id: int, db: Session) -> "Repo":
    """Get repo by ID or raise 404."""
    repo = db.query(Repo).filter(Repo.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail=ERROR_REPO_NOT_FOUND)
    return repo


def _validate_parent_category(parent_id: int, category_id: Optional[int], db: Session) -> None:
    """Validate parent category exists and no circular reference."""
    parent = db.query(Category).filter(Category.id == parent_id).first()
    if not parent:
        raise HTTPException(status_code=404, detail=ERROR_PARENT_CATEGORY_NOT_FOUND)
    if category_id and parent_id == category_id:
        raise HTTPException(status_code=400, detail=ERROR_CIRCULAR_REFERENCE)


def _apply_category_updates(category: "Category", request: CategoryUpdate) -> None:
    """Apply update fields to category."""
    if request.name is not None:
        category.name = request.name
    if request.description is not None:
        category.description = request.description
    if request.icon is not None:
        category.icon = request.icon
    if request.color is not None:
        category.color = request.color
    if request.parent_id is not None:
        category.parent_id = request.parent_id if request.parent_id else None
    if request.sort_order is not None:
        category.sort_order = request.sort_order


# Endpoints
@router.get("/", response_model=CategoryListResponse)
async def list_categories(
    db: Session = Depends(get_db)
):
    """
    List all categories (flat list).
    """
    categories = db.query(Category).order_by(Category.sort_order, Category.name).all()

    return CategoryListResponse(
        categories=[_category_to_response(c, db) for c in categories],
        total=len(categories),
    )


@router.get("/tree", response_model=CategoryTreeResponse)
async def get_category_tree(
    db: Session = Depends(get_db)
):
    """
    Get categories as a hierarchical tree structure.
    """
    categories = db.query(Category).all()
    tree = _build_tree(categories, None, db)

    return CategoryTreeResponse(
        tree=tree,
        total=len(categories),
    )


@router.get("/{category_id}", response_model=CategoryResponse)
async def get_category(
    category_id: int,
    db: Session = Depends(get_db)
):
    """
    Get a specific category by ID.
    """
    category = _get_category_or_404(category_id, db)
    return _category_to_response(category, db)


@router.post("/", response_model=CategoryResponse)
async def create_category(
    request: CategoryCreate,
    db: Session = Depends(get_db)
):
    """
    Create a new category.
    """
    # Validate parent if specified
    if request.parent_id:
        _validate_parent_category(request.parent_id, None, db)

    # Get next sort order
    max_order = db.query(Category.sort_order).order_by(Category.sort_order.desc()).first()
    next_order = (max_order[0] + 1) if max_order else 0

    category = Category(
        name=request.name,
        description=request.description,
        icon=request.icon,
        color=request.color,
        parent_id=request.parent_id,
        sort_order=next_order,
        created_at=utc_now(),
    )
    db.add(category)
    db.commit()
    db.refresh(category)

    return _category_to_response(category, db)


@router.put("/{category_id}", response_model=CategoryResponse)
async def update_category(
    category_id: int,
    request: CategoryUpdate,
    db: Session = Depends(get_db)
):
    """
    Update a category.
    """
    category = _get_category_or_404(category_id, db)

    # Validate parent if changing
    if request.parent_id is not None and request.parent_id != category.parent_id:
        if request.parent_id:
            _validate_parent_category(request.parent_id, category_id, db)

    # Update fields using a mapping for cleaner code
    _apply_category_updates(category, request)

    db.commit()
    db.refresh(category)

    return _category_to_response(category, db)


@router.delete("/{category_id}")
async def delete_category(
    category_id: int,
    db: Session = Depends(get_db)
):
    """
    Delete a category.
    Child categories will have their parent_id set to null.
    """
    category = _get_category_or_404(category_id, db)
    category_name = category.name
    db.delete(category)
    db.commit()

    return {"status": "ok", "message": f"Category '{category_name}' deleted"}


@router.get("/{category_id}/repos", response_model=CategoryReposResponse)
async def get_category_repos(
    category_id: int,
    db: Session = Depends(get_db)
):
    """
    Get all repositories in a category.
    """
    category = _get_category_or_404(category_id, db)

    repo_categories = db.query(RepoCategory).filter(
        RepoCategory.category_id == category_id
    ).all()

    repos = [_repo_category_to_response(rc) for rc in repo_categories]

    return CategoryReposResponse(
        category_id=category_id,
        category_name=category.name,
        repos=repos,
        total=len(repos),
    )


@router.post("/{category_id}/repos/{repo_id}")
async def add_repo_to_category(
    category_id: int,
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    Add a repository to a category.
    """
    category = _get_category_or_404(category_id, db)
    repo = _get_repo_or_404(repo_id, db)

    # Check if already in category
    existing = db.query(RepoCategory).filter(
        RepoCategory.category_id == category_id,
        RepoCategory.repo_id == repo_id
    ).first()

    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Repository is already in category '{category.name}'"
        )

    repo_category = RepoCategory(
        repo_id=repo_id,
        category_id=category_id,
        added_at=utc_now(),
    )
    db.add(repo_category)
    db.commit()

    return {
        "status": "ok",
        "message": f"Repository '{repo.full_name}' added to category '{category.name}'"
    }


@router.delete("/{category_id}/repos/{repo_id}")
async def remove_repo_from_category(
    category_id: int,
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    Remove a repository from a category.
    """
    category = _get_category_or_404(category_id, db)
    repo = _get_repo_or_404(repo_id, db)

    repo_category = db.query(RepoCategory).filter(
        RepoCategory.category_id == category_id,
        RepoCategory.repo_id == repo_id
    ).first()

    if not repo_category:
        raise HTTPException(status_code=404, detail=ERROR_REPO_NOT_IN_CATEGORY)

    db.delete(repo_category)
    db.commit()

    return {
        "status": "ok",
        "message": f"Repository '{repo.full_name}' removed from category '{category.name}'"
    }


@router.get("/repo/{repo_id}/categories")
async def get_repo_categories(
    repo_id: int,
    db: Session = Depends(get_db)
):
    """
    Get all categories for a repository.
    """
    _get_repo_or_404(repo_id, db)

    repo_categories = db.query(RepoCategory).filter(
        RepoCategory.repo_id == repo_id
    ).all()

    categories = [
        {
            "id": rc.category.id,
            "name": rc.category.name,
            "icon": rc.category.icon,
            "color": rc.category.color,
            "added_at": rc.added_at.isoformat() if rc.added_at else None,
        }
        for rc in repo_categories
    ]

    return {
        "repo_id": repo_id,
        "categories": categories,
        "total": len(categories),
    }
