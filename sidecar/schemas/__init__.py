"""
Pydantic schemas for API request/response models.
"""

from .repo import (
    RepoCreate,
    RepoResponse,
    RepoWithSignals,
    RepoListResponse,
    SnapshotResponse,
    SignalResponse,
)
from .response import (
    ApiResponse,
    PaginationInfo,
    ErrorDetail,
    ErrorCode,
    StatusResponse,
    success_response,
    error_response,
    paginated_response,
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
    "SnapshotResponse",
    "SignalResponse",
    # Response schemas
    "ApiResponse",
    "PaginationInfo",
    "ErrorDetail",
    "ErrorCode",
    "StatusResponse",
    "success_response",
    "error_response",
    "paginated_response",
    # Discovery schemas
    "DiscoveryRepo",
    "SearchResponse",
]
