"""
GitHub OAuth Device Flow authentication router.
Handles endpoints for connecting/disconnecting GitHub account.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from services.github_auth import (
    get_github_auth_service,
    GitHubAuthError,
    DeviceCodeResponse,
    ConnectionStatus,
)

router = APIRouter(prefix="/github-auth", tags=["github-auth"])


# ==================== Response Models ====================

class DeviceCodeResponseModel(BaseModel):
    """Response model for device code initiation."""
    device_code: str
    user_code: str
    verification_uri: str
    expires_in: int
    interval: int


class PollRequestModel(BaseModel):
    """Request model for polling authorization status."""
    device_code: str


class PollResponseModel(BaseModel):
    """Response model for poll endpoint."""
    status: str  # "success" | "pending" | "expired" | "error"
    username: Optional[str] = None
    error: Optional[str] = None
    slow_down: Optional[bool] = None


class ConnectionStatusModel(BaseModel):
    """Response model for connection status."""
    connected: bool
    username: Optional[str] = None
    rate_limit_remaining: Optional[int] = None
    rate_limit_total: Optional[int] = None
    error: Optional[str] = None


class DisconnectResponseModel(BaseModel):
    """Response model for disconnect endpoint."""
    success: bool
    message: str


# ==================== Endpoints ====================

@router.post("/device-code", response_model=DeviceCodeResponseModel)
async def initiate_device_flow():
    """
    Start the GitHub Device Flow authentication.

    Returns a device code and user code. The frontend should:
    1. Display the user_code to the user
    2. Open verification_uri in browser
    3. Start polling /poll endpoint with device_code
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
    Poll for authorization status.

    Call this endpoint periodically (respecting the interval from device-code)
    until status is "success" or "error"/"expired".

    Status values:
    - "pending": User hasn't authorized yet, keep polling
    - "success": Authorization complete, username included
    - "expired": Device code expired, need to restart flow
    - "error": Something went wrong, check error field
    """
    auth_service = get_github_auth_service()
    result = await auth_service.poll_for_token(request.device_code)

    return PollResponseModel(
        status=result["status"],
        username=result.get("username"),
        error=result.get("error"),
        slow_down=result.get("slow_down"),
    )


@router.get("/status", response_model=ConnectionStatusModel)
async def get_connection_status():
    """
    Get the current GitHub connection status.

    Returns whether connected, username, and API rate limit info.
    """
    auth_service = get_github_auth_service()
    status = await auth_service.get_connection_status()

    return ConnectionStatusModel(
        connected=status.connected,
        username=status.username,
        rate_limit_remaining=status.rate_limit_remaining,
        rate_limit_total=status.rate_limit_total,
        error=status.error,
    )


@router.post("/disconnect", response_model=DisconnectResponseModel)
async def disconnect():
    """
    Disconnect from GitHub by removing stored credentials.

    This removes the OAuth token from the database.
    The user will need to re-authenticate to use GitHub features.
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
