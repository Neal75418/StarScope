"""
健康檢查路由，驗證 sidecar 連線狀態。

此路由器已遷移至統一的 ApiResponse 格式（範例實現）。
"""

from fastapi import APIRouter
from pydantic import BaseModel

from utils.time import utc_now
from schemas.response import ApiResponse, success_response

router = APIRouter(prefix="/api", tags=["health"])


class HealthStatus(BaseModel):
    """健康狀態響應資料模型"""
    status: str
    service: str
    timestamp: str


@router.get("/health", response_model=ApiResponse[HealthStatus])
async def health_check() -> dict:
    """
    健康檢查端點。

    前端可呼叫此端點確認 Python sidecar 是否正在執行。

    Returns:
        統一格式的 ApiResponse，包含健康狀態資訊

    Example Response:
        {
            "success": true,
            "data": {
                "status": "ok",
                "service": "starscope-engine",
                "timestamp": "2024-02-21T10:30:00.123Z"
            },
            "message": "Service is healthy",
            "error": null
        }
    """
    health_data = HealthStatus(
        status="ok",
        service="starscope-engine",
        timestamp=utc_now().isoformat(),
    )

    return success_response(
        data=health_data,
        message="Service is healthy"
    )
