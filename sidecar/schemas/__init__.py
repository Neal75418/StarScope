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
    ErrorCode,
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
    # Response schemas
    "ApiResponse",
    "PaginationInfo",
    "ErrorDetail",
    "ErrorCode",
    "StatusResponse",
    "success_response",
    # Discovery schemas
    "DiscoveryRepo",
    "SearchResponse",
]
