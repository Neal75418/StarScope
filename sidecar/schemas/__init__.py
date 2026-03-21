"""
Pydantic schemas for API request/response models.
"""

from .repo import (
    RepoCreate,
    RepoResponse,
    RepoWithSignals,
    RepoListResponse,
    StarredRepo,
    StarredReposResponse,
    BatchRepoCreate,
    BatchImportResult,
)
from .response import (
    ApiResponse,
    PaginationInfo,
    ErrorDetail,
    StatusResponse,
    success_response,
)
from .discovery import (
    DiscoveryRepo,
    SearchResponse,
)

__all__ = [
    # Repo schemas
    "RepoCreate",
    "RepoResponse",
    "RepoWithSignals",
    "RepoListResponse",
    "StarredRepo",
    "StarredReposResponse",
    "BatchRepoCreate",
    "BatchImportResult",
    # 回應 schemas
    "ApiResponse",
    "PaginationInfo",
    "ErrorDetail",
    "StatusResponse",
    "success_response",
    # 探索 schemas
    "DiscoveryRepo",
    "SearchResponse",
]
