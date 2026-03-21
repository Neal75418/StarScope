"""
API 請求/回應的 Pydantic schemas。
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
    # Repo schemas（儲存庫）
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
