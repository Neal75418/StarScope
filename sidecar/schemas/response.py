"""統一 API 回應 schemas，確保回應格式一致。"""

from typing import TypeVar, Generic, Any
from pydantic import BaseModel, Field

# 泛型資料載荷型別
T = TypeVar("T")


class PaginationInfo(BaseModel):
    """列表回應的分頁資訊。"""
    page: int = Field(1, ge=1, description="Current page number")
    per_page: int = Field(20, ge=1, le=100, description="Items per page")
    total: int = Field(0, ge=0, description="Total number of items")
    total_pages: int = Field(0, ge=0, description="Total number of pages")


class ApiResponse(BaseModel, Generic[T]):
    """
    統一 API 回應封裝。

    所有 API 端點應以此格式回傳，確保一致性。

    範例：
        成功回應：
            {
                "success": true,
                "data": {"id": 1, "name": "example"},
                "message": null,
                "error": null
            }

        錯誤回應：
            {
                "success": false,
                "data": null,
                "message": "Resource not found",
                "error": {"code": "NOT_FOUND", "details": null}
            }

        分頁列表回應：
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
    """結構化錯誤資訊。"""
    code: str = Field(..., description="Error code for programmatic handling")
    details: Any | None = Field(None, description="Additional error details")


# 更新前向參照
ApiResponse.model_rebuild()


# 建立回應的輔助函式
def success_response(
    data: Any = None,
    message: str | None = None,
    pagination: PaginationInfo | None = None
) -> dict:
    """
    建立成功的 API 回應。

    Args:
        data: 回應資料載荷
        message: 選填成功訊息
        pagination: 選填分頁資訊（用於列表回應）

    Returns:
        以 ApiResponse 格式化的 dict
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


# 簡單操作的狀態回應
class StatusResponse(BaseModel):
    """簡單操作（刪除、確認等）的狀態回應。"""
    status: str = "ok"
    message: str | None = None
    id: int | None = None
    count: int | None = None
