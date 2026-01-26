"""
GitHub Device Flow authentication service.
Handles OAuth device flow for desktop applications.
"""

import logging
import os
import httpx
from typing import Optional
from dataclasses import dataclass

from db.models import AppSettingKey
from services.settings import get_setting, set_setting, delete_setting
from services.github import reset_github_service

logger = logging.getLogger(__name__)

# GitHub OAuth endpoints
GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code"
GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_USER_URL = "https://api.github.com/user"
GITHUB_RATE_LIMIT_URL = "https://api.github.com/rate_limit"

# Read Client ID from environment variable
# User must set this in .env file
GITHUB_CLIENT_ID_ENV_VAR = "GITHUB_CLIENT_ID"

# OAuth scopes needed for StarScope
# - repo: Access to public/private repositories (for private repo tracking)
# - read:user: Read user profile information
GITHUB_OAUTH_SCOPES = "repo read:user"


@dataclass
class DeviceCodeResponse:
    """Response from GitHub device code endpoint."""
    device_code: str
    user_code: str
    verification_uri: str
    expires_in: int
    interval: int


@dataclass
class ConnectionStatus:
    """GitHub connection status."""
    connected: bool
    username: Optional[str] = None
    rate_limit_remaining: Optional[int] = None
    rate_limit_total: Optional[int] = None
    rate_limit_reset: Optional[int] = None  # Unix timestamp when limit resets
    error: Optional[str] = None


class GitHubAuthError(Exception):
    """Custom exception for GitHub auth errors."""
    pass


class GitHubAuthService:
    """Service for handling GitHub Device Flow authentication."""

    def __init__(self):
        self.client_id = os.getenv(GITHUB_CLIENT_ID_ENV_VAR)
        if not self.client_id:
            logger.warning(
                f"GitHub Client ID not configured. "
                f"Set {GITHUB_CLIENT_ID_ENV_VAR} in .env file to enable GitHub OAuth."
            )

    async def initiate_device_flow(self) -> DeviceCodeResponse:
        """
        Start the device flow authentication.
        Returns a device code and user code for the user to enter on GitHub.

        Raises:
            GitHubAuthError: If device flow initiation fails
        """
        if not self.client_id:
            raise GitHubAuthError(
                f"GitHub Client ID not configured. "
                f"Please set {GITHUB_CLIENT_ID_ENV_VAR} in your .env file."
            )

        async with httpx.AsyncClient() as client:
            response = await client.post(
                GITHUB_DEVICE_CODE_URL,
                data={
                    "client_id": self.client_id,
                    "scope": GITHUB_OAUTH_SCOPES,
                },
                headers={"Accept": "application/json"},
            )

            if response.status_code != 200:
                logger.error(f"Device flow initiation failed: {response.text}", exc_info=True)
                raise GitHubAuthError(
                    f"Failed to initiate device flow: {response.status_code}"
                )

            data = response.json()
            logger.info(f"Device flow initiated. User code: {data.get('user_code')}")

            return DeviceCodeResponse(
                device_code=data["device_code"],
                user_code=data["user_code"],
                verification_uri=data["verification_uri"],
                expires_in=data["expires_in"],
                interval=data["interval"],
            )

    async def poll_for_token(self, device_code: str) -> dict:
        """
        Poll GitHub for the access token after user authorizes.

        Returns:
            dict with keys:
                - status: "success" | "pending" | "expired" | "error"
                - access_token: (only if success)
                - username: (only if success)
                - error: (only if error)
        """
        logger.info(f"Polling for token with device_code: {device_code[:8]}...")

        if not self.client_id:
            logger.error("Client ID not configured", exc_info=True)
            return {"status": "error", "error": "Client ID not configured"}

        async with httpx.AsyncClient() as client:
            response = await client.post(
                GITHUB_ACCESS_TOKEN_URL,
                data={
                    "client_id": self.client_id,
                    "device_code": device_code,
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                },
                headers={"Accept": "application/json"},
            )

            if response.status_code != 200:
                logger.error(f"Poll failed: HTTP {response.status_code}", exc_info=True)
                return {"status": "error", "error": f"HTTP {response.status_code}"}

            data = response.json()
            logger.info(f"Poll response: {data}")

            # Check for errors
            error = data.get("error")
            if error == "authorization_pending":
                logger.info("Authorization pending...")
                return {"status": "pending"}
            elif error == "slow_down":
                new_interval = data.get("interval", 10)
                logger.info(f"Rate limited, slowing down to {new_interval}s interval")
                return {"status": "pending", "slow_down": True, "interval": new_interval}
            elif error == "expired_token":
                logger.warning("Device code expired")
                return {"status": "expired", "error": "Device code expired"}
            elif error == "access_denied":
                logger.warning("User denied access")
                return {"status": "error", "error": "User denied access"}
            elif error:
                logger.error(f"Unknown error: {error}", exc_info=True)
                return {"status": "error", "error": error}

            # Success! We have an access token
            access_token = data.get("access_token")
            if not access_token:
                return {"status": "error", "error": "No access token in response"}

            # Get user info
            username = await self._get_username(access_token)

            # Save token and username to database
            set_setting(AppSettingKey.GITHUB_TOKEN, access_token)
            if username:
                set_setting(AppSettingKey.GITHUB_USERNAME, username)

            # Reset the GitHub service to pick up the new token
            reset_github_service()

            logger.info(f"GitHub connected successfully as @{username}")

            return {
                "status": "success",
                "access_token": access_token,
                "username": username,
            }

    @staticmethod
    async def _get_username(token: str) -> Optional[str]:
        """Get the GitHub username for a token."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                GITHUB_USER_URL,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/vnd.github+json",
                },
            )
            if response.status_code == 200:
                return response.json().get("login")
            return None

    @staticmethod
    async def get_connection_status() -> ConnectionStatus:
        """
        Get the current GitHub connection status.
        Checks if we have a valid token and returns user info.
        """
        token = get_setting(AppSettingKey.GITHUB_TOKEN)

        if not token:
            return ConnectionStatus(connected=False)

        # Verify token is still valid by checking rate limit
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    GITHUB_RATE_LIMIT_URL,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Accept": "application/vnd.github+json",
                    },
                    timeout=10.0,
                )

                if response.status_code == 401:
                    # Token is invalid, clean up
                    delete_setting(AppSettingKey.GITHUB_TOKEN)
                    delete_setting(AppSettingKey.GITHUB_USERNAME)
                    reset_github_service()
                    return ConnectionStatus(
                        connected=False,
                        error="Token expired or revoked"
                    )

                if response.status_code == 200:
                    data = response.json()
                    core_limit = data.get("resources", {}).get("core", {})
                    username = get_setting(AppSettingKey.GITHUB_USERNAME)

                    return ConnectionStatus(
                        connected=True,
                        username=username,
                        rate_limit_remaining=core_limit.get("remaining"),
                        rate_limit_total=core_limit.get("limit"),
                        rate_limit_reset=core_limit.get("reset"),
                    )

                return ConnectionStatus(
                    connected=False,
                    error=f"Unexpected status: {response.status_code}"
                )

            except httpx.TimeoutException:
                return ConnectionStatus(
                    connected=True,  # Assume connected if just a timeout
                    username=get_setting(AppSettingKey.GITHUB_USERNAME),
                    error="Connection timeout"
                )
            except httpx.RequestError as e:
                return ConnectionStatus(
                    connected=True,  # Assume connected if network error
                    username=get_setting(AppSettingKey.GITHUB_USERNAME),
                    error=f"Network error: {str(e)}"
                )

    @staticmethod
    def disconnect() -> bool:
        """
        Disconnect from GitHub by removing stored credentials.
        Returns True if credentials were removed, False if none existed.
        """
        token_deleted = delete_setting(AppSettingKey.GITHUB_TOKEN)
        delete_setting(AppSettingKey.GITHUB_USERNAME)

        # Reset the GitHub service
        reset_github_service()

        if token_deleted:
            logger.info("GitHub disconnected successfully")

        return token_deleted


# Module-level singleton
_auth_service: Optional[GitHubAuthService] = None


def get_github_auth_service() -> GitHubAuthService:
    """Get the singleton GitHub auth service instance."""
    global _auth_service
    if _auth_service is None:
        _auth_service = GitHubAuthService()
    return _auth_service
