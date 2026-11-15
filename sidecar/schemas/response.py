"""統一 API 回應 schemas，確保回應格式一致。"""

from typing import TypeVar, Generic, Any
from pydantic import BaseModel

# 泛型資料載荷型別
T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    """
    統一 API 回應封裝。

    JSON 端點成功時用這個格式（檔案下載不包這一層）。失敗不走這裡：回 HTTP 錯誤狀態，
    body 是 {"detail"}，main.py 的部分 exception handler 另帶 "code"。

    範例：
        {
            "success": true,
            "data": {"id": 1, "name": "example"},
            "message": null
        }
    """
    success: bool = True
    data: T | None = None
    message: str | None = None

    model_config = {"from_attributes": True}


# 建立回應的輔助函式
def success_response(data: Any = None, message: str | None = None) -> dict:
    """
    建立成功的 API 回應。

    Args:
        data: 回應資料載荷
        message: 選填成功訊息

    Returns:
        以 ApiResponse 格式化的 dict
    """
    return {
        "success": True,
        "data": data,
        "message": message,
    }


# 簡單操作的狀態回應
class StatusResponse(BaseModel):
    """簡單操作（刪除、確認等）的狀態回應。"""
    status: str = "ok"
    message: str | None = None
    id: int | None = None
    count: int | None = None
