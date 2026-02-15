"""
健康檢查路由，驗證 sidecar 連線狀態。
"""

from fastapi import APIRouter

from utils.time import utc_now

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
async def health_check():
    """
    健康檢查端點。
    前端可呼叫此端點確認 Python sidecar 是否正在執行。
    """
    return {
        "status": "ok",
        "service": "starscope-engine",
        "timestamp": utc_now().isoformat(),
    }
