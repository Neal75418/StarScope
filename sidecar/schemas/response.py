"""
Unified API response schemas for consistent response formatting.
"""

from typing import TypeVar, Generic, Optional, Any
from pydantic import BaseModel, Field

# Generic type for data payload
T = TypeVar("T")


class PaginationInfo(BaseModel):
    """Pagination metadata for list responses."""
    page: int = Field(1, ge=1, description="Current page number")
    per_page: int = Field(20, ge=1, le=100, description="Items per page")
    total: int = Field(0, ge=0, description="Total number of items")
    total_pages: int = Field(0, ge=0, description="Total number of pages")


class ApiResponse(BaseModel, Generic[T]):
    """
    Unified API response wrapper.

    All API endpoints should return responses in this format for consistency.

    Examples:
        Success response:
            {
                "success": true,
                "data": {"id": 1, "name": "example"},
                "message": null,
                "error": null
            }

        Error response:
            {
                "success": false,
                "data": null,
                "message": "Resource not found",
                "error": {"code": "NOT_FOUND", "details": null}
            }

        List response with pagination:
            {
                "success": true,
                "data": [{"id": 1}, {"id": 2}],
                "message": null,
                "error": null,
                "pagination": {"page": 1, "per_page": 20, "total": 100, "total_pages": 5}
            }
    """
    success: bool = True
    data: Optional[T] = None
    message: Optional[str] = None
    error: Optional["ErrorDetail"] = None
    pagination: Optional[PaginationInfo] = None

    model_config = {"from_attributes": True}


class ErrorDetail(BaseModel):
    """Structured error information."""
    code: str = Field(..., description="Error code for programmatic handling")
    details: Optional[Any] = Field(None, description="Additional error details")


# Update forward reference
ApiResponse.model_rebuild()


# Common error codes
class ErrorCode:
    """Standard error codes for API responses."""
    NOT_FOUND = "NOT_FOUND"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    ALREADY_EXISTS = "ALREADY_EXISTS"
    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN = "FORBIDDEN"
    RATE_LIMITED = "RATE_LIMITED"
    EXTERNAL_API_ERROR = "EXTERNAL_API_ERROR"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    BAD_REQUEST = "BAD_REQUEST"


# Helper functions for creating responses
def success_response(
    data: Any = None,
    message: Optional[str] = None,
    pagination: Optional[PaginationInfo] = None
) -> dict:
    """
    Create a successful API response.

    Args:
        data: The response payload
        message: Optional success message
        pagination: Optional pagination info for list responses

    Returns:
        Dict formatted as ApiResponse
    """
    response = {
        "success": True,
        "data": data,
        "message": message,
        "error": None,
    }
    if pagination:
        response["pagination"] = pagination.model_dump()
    return response


def error_response(
    message: str,
    code: str = ErrorCode.INTERNAL_ERROR,
    details: Optional[Any] = None
) -> dict:
    """
    Create an error API response.

    Args:
        message: Human-readable error message
        code: Error code from ErrorCode constants
        details: Additional error details

    Returns:
        Dict formatted as ApiResponse with error
    """
    return {
        "success": False,
        "data": None,
        "message": message,
        "error": {
            "code": code,
            "details": details,
        },
    }


def paginated_response(
    items: list[Any],
    total: int,
    page: int = 1,
    per_page: int = 20,
    message: Optional[str] = None
) -> dict:
    """
    Create a paginated list response.

    Args:
        items: List of items for current page
        total: Total number of items across all pages
        page: Current page number
        per_page: Items per page
        message: Optional message

    Returns:
        Dict formatted as ApiResponse with pagination
    """
    total_pages = (total + per_page - 1) // per_page if per_page > 0 else 0

    pagination = PaginationInfo(
        page=page,
        per_page=per_page,
        total=total,
        total_pages=total_pages
    )

    return success_response(
        data=items,
        message=message,
        pagination=pagination
    )


# Status response for simple operations
class StatusResponse(BaseModel):
    """Simple status response for operations like delete, acknowledge, etc."""
    status: str = "ok"
    message: Optional[str] = None
    id: Optional[int] = None
    count: Optional[int] = None
