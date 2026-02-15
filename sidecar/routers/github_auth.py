"""
GitHub OAuth Device Flow 驗證路由。
處理 GitHub 帳號連結/斷開的端點。
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from services.github_auth import (
    get_github_auth_service,
    GitHubAuthError,
)

router = APIRouter(prefix="/api/github-auth", tags=["github-auth"])


# ==================== 回應 Model ====================

class DeviceCodeResponseModel(BaseModel):
    """Device code 啟動的回應 model。"""
    device_code: str
    user_code: str
    verification_uri: str
    expires_in: int
    interval: int


class PollRequestModel(BaseModel):
    """輪詢授權狀態的請求 model。"""
    device_code: str


class PollResponseModel(BaseModel):
    """輪詢端點的回應 model。"""
    status: str  # "success" | "pending" | "expired" | "error"
    username: Optional[str] = None
    error: Optional[str] = None
    slow_down: Optional[bool] = None
    interval: Optional[int] = None


class ConnectionStatusModel(BaseModel):
    """連線狀態的回應 model。"""
    connected: bool
    username: Optional[str] = None
    rate_limit_remaining: Optional[int] = None
    rate_limit_total: Optional[int] = None
    rate_limit_reset: Optional[int] = None  # 限制重設的 Unix 時間戳記
    error: Optional[str] = None


class DisconnectResponseModel(BaseModel):
    """斷開連結端點的回應 model。"""
    success: bool
    message: str


# ==================== 端點 ====================

@router.post("/device-code", response_model=DeviceCodeResponseModel)
async def initiate_device_flow():
    """
    啟動 GitHub Device Flow 驗證。

    回傳 device code 與 user code。前端應：
    1. 向使用者顯示 user_code
    2. 在瀏覽器中開啟 verification_uri
    3. 開始以 device_code 輪詢 /poll 端點
    """
    try:
        auth_service = get_github_auth_service()
        result = await auth_service.initiate_device_flow()
        return DeviceCodeResponseModel(
            device_code=result.device_code,
            user_code=result.user_code,
            verification_uri=result.verification_uri,
            expires_in=result.expires_in,
            interval=result.interval,
        )
    except GitHubAuthError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/poll", response_model=PollResponseModel)
async def poll_authorization(request: PollRequestModel):
    """
    輪詢授權狀態。

    定期呼叫此端點（遵守 device-code 回傳的 interval），
    直到狀態為 "success" 或 "error"/"expired"。

    狀態值：
    - "pending": 使用者尚未授權，繼續輪詢
    - "success": 授權完成，包含 username
    - "expired": Device code 已過期，需重新啟動流程
    - "error": 發生錯誤，檢查 error 欄位
    """
    auth_service = get_github_auth_service()
    result = await auth_service.poll_for_token(request.device_code)

    return PollResponseModel(
        status=result["status"],
        username=result.get("username"),
        error=result.get("error"),
        slow_down=result.get("slow_down"),
        interval=result.get("interval"),
    )


@router.get("/status", response_model=ConnectionStatusModel)
async def get_connection_status():
    """
    取得目前的 GitHub 連線狀態。

    回傳是否已連線、使用者名稱及 API 速率限制資訊。
    """
    auth_service = get_github_auth_service()
    status = await auth_service.get_connection_status()

    return ConnectionStatusModel(
        connected=status.connected,
        username=status.username,
        rate_limit_remaining=status.rate_limit_remaining,
        rate_limit_total=status.rate_limit_total,
        rate_limit_reset=status.rate_limit_reset,
        error=status.error,
    )


@router.post("/disconnect", response_model=DisconnectResponseModel)
async def disconnect():
    """
    移除已儲存的憑證以斷開 GitHub 連結。

    從資料庫移除 OAuth token。
    使用者需重新驗證才能使用 GitHub 功能。
    """
    auth_service = get_github_auth_service()
    was_connected = auth_service.disconnect()

    if was_connected:
        return DisconnectResponseModel(
            success=True,
            message="Successfully disconnected from GitHub"
        )
    else:
        return DisconnectResponseModel(
            success=True,
            message="No GitHub connection to disconnect"
        )
