"""統一 API 回應 schemas，確保回應格式一致。"""

from typing import TypeVar, Generic, Any
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
    data: T | None = None
    message: str | None = None
    error: "ErrorDetail | None" = None
    pagination: PaginationInfo | None = None

    model_config = {"from_attributes": True}


class ErrorDetail(BaseModel):
    """Structured error information."""
    code: str = Field(..., description="Error code for programmatic handling")
    details: Any | None = Field(None, description="Additional error details")


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
    message: str | None = None,
    pagination: PaginationInfo | None = None
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




# Status response for simple operations
class StatusResponse(BaseModel):
    """Simple status response for operations like delete, acknowledge, etc."""
    status: str = "ok"
    message: str | None = None
    id: int | None = None
    count: int | None = None
