"""
分類 API 端點。
提供使用者自訂 repo 分類的 CRUD 操作。
"""

from typing import Dict, List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from db.database import get_db
from db.models import Category, RepoCategory
from routers.dependencies import get_repo_or_404
from utils.time import utc_now
from schemas.response import ApiResponse, success_response, StatusResponse

# 錯誤訊息常數
ERROR_CATEGORY_NOT_FOUND = "Category not found"
ERROR_PARENT_CATEGORY_NOT_FOUND = "Parent category not found"
ERROR_CIRCULAR_REFERENCE = "Circular reference detected in category hierarchy"
ERROR_REPO_NOT_IN_CATEGORY = "Repository is not in this category"

router = APIRouter(prefix="/api/categories", tags=["categories"])


# 請求/回應 schema
class CategoryCreate(BaseModel):
    """建立分類的 schema。"""
    name: str
    description: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    parent_id: Optional[int] = None


class CategoryUpdate(BaseModel):
    """更新分類的 schema。"""
    name: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    parent_id: Optional[int] = None
    sort_order: Optional[int] = None


class CategoryResponse(BaseModel):
    """分類的 schema。"""
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
    """樹狀結構中的分類 schema。"""
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
    """分類列表的回應。"""
    categories: List[CategoryResponse]
    total: int


class CategoryTreeResponse(BaseModel):
    """分類樹的回應。"""
    tree: List[CategoryTreeNode]
    total: int


class RepoCategoryResponse(BaseModel):
    """分類中 repo 的 schema。"""
    id: int
    full_name: str
    description: Optional[str]
    language: Optional[str]
    added_at: datetime


class CategoryReposResponse(BaseModel):
    """分類中 repo 的回應。"""
    category_id: int
    category_name: str
    repos: List[RepoCategoryResponse]
    total: int


class RepoCategoryItem(BaseModel):
    """repo 的分類項目。"""
    id: int
    name: str
    icon: Optional[str]
    color: Optional[str]
    added_at: Optional[str]


class RepoCategoriesResponse(BaseModel):
    """repo 所屬分類的回應。"""
    repo_id: int
    categories: List[RepoCategoryItem]
    total: int


# 輔助函式
def _build_repo_count_map(db: Session) -> Dict[int, int]:
    """以單一查詢批次載入所有分類的 repo 數量。"""
    rows = db.query(
        RepoCategory.category_id,
        func.count(RepoCategory.repo_id),
    ).group_by(RepoCategory.category_id).all()
    return dict((cat_id, count) for cat_id, count in rows)


def _get_repo_count(category_id: int, db: Session) -> int:
    """取得單一分類中的 repo 數量。"""
    return db.query(RepoCategory).filter(RepoCategory.category_id == category_id).count()


def _category_base_fields(category: Category, repo_count_map: Dict[int, int]) -> Dict:
    """擷取 CategoryResponse 與 CategoryTreeNode 共用的欄位。"""
    return {
        "id": category.id,
        "name": category.name,
        "description": category.description,
        "icon": category.icon,
        "color": category.color,
        "sort_order": category.sort_order,
        "repo_count": repo_count_map.get(category.id, 0),
    }


def _category_to_response(
    category: Category,
    repo_count_map: Dict[int, int],
) -> CategoryResponse:
    """將 Category model 轉換為回應。"""
    return CategoryResponse(
        **_category_base_fields(category, repo_count_map),
        parent_id=category.parent_id,
        created_at=category.created_at,
    )


def _build_tree(
    categories: List[Category],
    parent_id: Optional[int],
    repo_count_map: Dict[int, int],
) -> List[CategoryTreeNode]:
    """從扁平分類列表建立樹狀結構。"""
    nodes = []
    for cat in categories:
        if cat.parent_id == parent_id:
            children = _build_tree(categories, cat.id, repo_count_map)
            node = CategoryTreeNode(
                **_category_base_fields(cat, repo_count_map),
                children=children,
            )
            nodes.append(node)
    return sorted(nodes, key=lambda x: x.sort_order)


def _repo_category_to_response(rc: RepoCategory) -> RepoCategoryResponse:
    """將 RepoCategory model 轉換為 RepoCategoryResponse。"""
    return RepoCategoryResponse(
        id=rc.repo.id,
        full_name=rc.repo.full_name,
        description=rc.repo.description,
        language=rc.repo.language,
        added_at=rc.added_at,
    )


def _get_category_or_404(category_id: int, db: Session) -> Category:
    """依 ID 取得分類，不存在則拋出 404。"""
    # noinspection PyTypeChecker
    category: Optional[Category] = db.query(Category).filter(Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail=ERROR_CATEGORY_NOT_FOUND)
    return category



def _validate_parent_category(parent_id: int, category_id: Optional[int], db: Session) -> None:
    """驗證父分類是否存在且無循環參考（含間接循環）。"""
    parent = db.query(Category).filter(Category.id == parent_id).first()
    if not parent:
        raise HTTPException(status_code=404, detail=ERROR_PARENT_CATEGORY_NOT_FOUND)
    if not category_id:
        return
    # 走訪祖先鏈，檢查直接與間接循環
    visited = {category_id}
    current_id: Optional[int] = parent_id
    while current_id is not None:
        if current_id in visited:
            raise HTTPException(status_code=400, detail=ERROR_CIRCULAR_REFERENCE)
        visited.add(current_id)
        ancestor = db.query(Category).filter(Category.id == current_id).first()
        if not ancestor:
            break
        current_id = ancestor.parent_id  # type: ignore[assignment]  # InstrumentedAttribute → int


def _find_repo_category(category_id: int, repo_id: int, db: Session) -> Optional[RepoCategory]:
    """依分類與 repo ID 查詢 RepoCategory 關聯。"""
    return db.query(RepoCategory).filter(
        RepoCategory.category_id == category_id,
        RepoCategory.repo_id == repo_id
    ).first()


def _apply_category_updates(category: Category, request: CategoryUpdate) -> None:
    """將請求中明確提供的欄位套用至分類（使用 model_fields_set 區分「未送」與「送 null」）。"""
    for field in ("name", "description", "icon", "color", "sort_order"):
        if field in request.model_fields_set:
            setattr(category, field, getattr(request, field))
    if "parent_id" in request.model_fields_set:
        category.parent_id = request.parent_id


# 端點
@router.get("/", response_model=ApiResponse[CategoryListResponse])
async def list_categories(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
) -> dict:
    """
    列出所有分類（扁平列表），含分頁。

    Args:
        skip: 跳過的紀錄數（預設 0）
        limit: 回傳的最大紀錄數（預設 100，上限 500）
        db: 資料庫 session
    """
    # 限制上限以防止過量資料擷取
    limit = min(limit, 500)

    # 取得總數
    total = db.query(Category).count()

    # noinspection PyTypeChecker
    categories: List[Category] = (
        db.query(Category)
        .order_by(Category.sort_order, Category.name)
        .offset(skip)
        .limit(limit)
        .all()
    )
    repo_count_map = _build_repo_count_map(db)

    category_list = CategoryListResponse(
        categories=[_category_to_response(c, repo_count_map) for c in categories],
        total=total,
    )

    return success_response(
        data=category_list,
        message=f"Found {total} categories"
    )


@router.get("/tree", response_model=ApiResponse[CategoryTreeResponse])
async def get_category_tree(
    db: Session = Depends(get_db)
) -> dict:
    """
    以階層樹狀結構取得分類。
    """
    # noinspection PyTypeChecker
    categories: List[Category] = db.query(Category).all()
    repo_count_map = _build_repo_count_map(db)
    tree = _build_tree(categories, None, repo_count_map)

    category_tree = CategoryTreeResponse(
        tree=tree,
        total=len(categories),
    )

    return success_response(
        data=category_tree,
        message=f"Retrieved category tree with {len(categories)} categories"
    )


@router.get("/{category_id}", response_model=ApiResponse[CategoryResponse])
async def get_category(
    category_id: int,
    db: Session = Depends(get_db)
) -> dict:
    """
    依 ID 取得特定分類。
    """
    category = _get_category_or_404(category_id, db)
    count = _get_repo_count(category_id, db)
    category_response = _category_to_response(category, {category_id: count})

    return success_response(
        data=category_response,
        message=f"Retrieved category '{category.name}'"
    )


@router.post("/", response_model=ApiResponse[CategoryResponse])
async def create_category(
    request: CategoryCreate,
    db: Session = Depends(get_db)
) -> dict:
    """
    建立新分類。
    """
    # 驗證指定的父分類
    if request.parent_id:
        _validate_parent_category(request.parent_id, None, db)

    # 取得下一個排序順序
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

    # 新建立的分類有 0 個 repo
    category_response = _category_to_response(category, {})

    return success_response(
        data=category_response,
        message=f"Category '{category.name}' created successfully"
    )


@router.put("/{category_id}", response_model=ApiResponse[CategoryResponse])
async def update_category(
    category_id: int,
    request: CategoryUpdate,
    db: Session = Depends(get_db)
) -> dict:
    """
    更新分類。
    """
    category = _get_category_or_404(category_id, db)

    # 變更父分類時進行驗證
    if "parent_id" in request.model_fields_set and request.parent_id != category.parent_id:
        if request.parent_id is not None:
            _validate_parent_category(request.parent_id, category_id, db)

    # 使用映射更新欄位以簡化程式碼
    _apply_category_updates(category, request)

    db.commit()
    db.refresh(category)

    count = _get_repo_count(category_id, db)
    category_response = _category_to_response(category, {category_id: count})

    return success_response(
        data=category_response,
        message=f"Category '{category.name}' updated successfully"
    )


@router.delete("/{category_id}", response_model=ApiResponse[StatusResponse])
async def delete_category(
    category_id: int,
    db: Session = Depends(get_db)
) -> dict:
    """
    刪除分類。
    子分類的 parent_id 將被設為 null。
    """
    category = _get_category_or_404(category_id, db)
    category_name = category.name
    db.delete(category)
    db.commit()

    return success_response(
        data=StatusResponse(status="ok"),
        message=f"Category '{category_name}' deleted successfully"
    )


@router.get("/{category_id}/repos", response_model=ApiResponse[CategoryReposResponse])
async def get_category_repos(
    category_id: int,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
) -> dict:
    """
    取得分類中的所有 repo（含分頁）。

    Args:
        category_id: 分類 ID
        skip: 跳過的紀錄數（預設 0）
        limit: 回傳的最大紀錄數（預設 100，上限 500）
        db: 資料庫 session
    """
    # 限制上限以防止過量資料擷取
    limit = min(limit, 500)

    category = _get_category_or_404(category_id, db)

    # 取得總數
    total = db.query(RepoCategory).filter(
        RepoCategory.category_id == category_id
    ).count()

    # noinspection PyTypeChecker
    repo_categories: List[RepoCategory] = (
        db.query(RepoCategory)
        .options(joinedload(RepoCategory.repo))
        .filter(RepoCategory.category_id == category_id)
        .order_by(RepoCategory.id)
        .offset(skip)
        .limit(limit)
        .all()
    )

    repos = [_repo_category_to_response(rc) for rc in repo_categories]

    repos_response = CategoryReposResponse(
        category_id=category_id,
        category_name=category.name,
        repos=repos,
        total=total,
    )

    return success_response(
        data=repos_response,
        message=f"Found {total} repositories in category '{category.name}'"
    )


@router.post("/{category_id}/repos/{repo_id}", response_model=ApiResponse[StatusResponse])
async def add_repo_to_category(
    category_id: int,
    repo_id: int,
    db: Session = Depends(get_db)
) -> dict:
    """
    將 repo 加入分類。
    """
    category = _get_category_or_404(category_id, db)
    repo = get_repo_or_404(repo_id, db)

    if _find_repo_category(category_id, repo_id, db):
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

    return success_response(
        data=StatusResponse(status="ok"),
        message=f"Repository '{repo.full_name}' added to category '{category.name}'"
    )


@router.delete("/{category_id}/repos/{repo_id}", response_model=ApiResponse[StatusResponse])
async def remove_repo_from_category(
    category_id: int,
    repo_id: int,
    db: Session = Depends(get_db)
) -> dict:
    """
    從分類中移除 repo。
    """
    category = _get_category_or_404(category_id, db)
    repo = get_repo_or_404(repo_id, db)

    repo_category = _find_repo_category(category_id, repo_id, db)
    if not repo_category:
        raise HTTPException(status_code=404, detail=ERROR_REPO_NOT_IN_CATEGORY)

    db.delete(repo_category)
    db.commit()

    return success_response(
        data=StatusResponse(status="ok"),
        message=f"Repository '{repo.full_name}' removed from category '{category.name}'"
    )


@router.get("/repo/{repo_id}/categories", response_model=ApiResponse[RepoCategoriesResponse])
async def get_repo_categories(
    repo_id: int,
    db: Session = Depends(get_db)
) -> dict:
    """
    取得 repo 所屬的所有分類。
    """
    get_repo_or_404(repo_id, db)

    repo_categories = db.query(RepoCategory).options(
        joinedload(RepoCategory.category)
    ).filter(
        RepoCategory.repo_id == repo_id
    ).all()

    categories = [
        RepoCategoryItem(
            id=rc.category.id,
            name=rc.category.name,
            icon=rc.category.icon,
            color=rc.category.color,
            added_at=rc.added_at.isoformat() if rc.added_at else None,
        )
        for rc in repo_categories
    ]

    repo_categories_response = RepoCategoriesResponse(
        repo_id=repo_id,
        categories=categories,
        total=len(categories),
    )

    return success_response(
        data=repo_categories_response,
        message=f"Repository belongs to {len(categories)} categories"
    )
