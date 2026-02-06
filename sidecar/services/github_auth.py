"""
GitHub Device Flow 驗證服務。
處理桌面應用程式的 OAuth device flow。
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

# GitHub OAuth 端點
GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code"
GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_USER_URL = "https://api.github.com/user"
GITHUB_RATE_LIMIT_URL = "https://api.github.com/rate_limit"

# 從環境變數讀取 Client ID
# 使用者需在 .env 檔案中設定
GITHUB_CLIENT_ID_ENV_VAR = "GITHUB_CLIENT_ID"

# StarScope 所需的 OAuth scopes
# - repo: 存取公開/私有 repo（用於追蹤私有 repo）
# - read:user: 讀取使用者個人資訊
GITHUB_OAUTH_SCOPES = "repo read:user"


@dataclass
class DeviceCodeResponse:
    """GitHub device code 端點的回應。"""
    device_code: str
    user_code: str
    verification_uri: str
    expires_in: int
    interval: int


@dataclass
class ConnectionStatus:
    """GitHub 連線狀態。"""
    connected: bool
    username: Optional[str] = None
    rate_limit_remaining: Optional[int] = None
    rate_limit_total: Optional[int] = None
    rate_limit_reset: Optional[int] = None  # 限制重設的 Unix 時間戳記
    error: Optional[str] = None


class GitHubAuthError(Exception):
    """GitHub 驗證錯誤的自訂例外。"""
    pass


class GitHubAuthService:
    """處理 GitHub Device Flow 驗證的服務。"""

    def __init__(self):
        self.client_id = os.getenv(GITHUB_CLIENT_ID_ENV_VAR)
        if not self.client_id:
            logger.warning(
                f"[GitHub 驗證] 未設定 GitHub Client ID，"
                f"請在 .env 檔案中設定 {GITHUB_CLIENT_ID_ENV_VAR} 以啟用 GitHub OAuth"
            )

    async def initiate_device_flow(self) -> DeviceCodeResponse:
        """
        啟動 device flow 驗證。
        回傳 device code 與 user code 供使用者在 GitHub 上輸入。

        Raises:
            GitHubAuthError: device flow 啟動失敗時拋出
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
                logger.error(f"[GitHub 驗證] Device flow 啟動失敗: {response.text}", exc_info=True)
                raise GitHubAuthError(
                    f"Failed to initiate device flow: {response.status_code}"
                )

            data = response.json()
            logger.info(f"[GitHub 驗證] Device flow 已啟動，使用者代碼: {data.get('user_code')}")

            return DeviceCodeResponse(
                device_code=data["device_code"],
                user_code=data["user_code"],
                verification_uri=data["verification_uri"],
                expires_in=data["expires_in"],
                interval=data["interval"],
            )

    async def poll_for_token(self, device_code: str) -> dict:
        """
        使用者授權後輪詢 GitHub 取得 access token。

        Returns:
            包含以下 key 的字典：
                - status: "success" | "pending" | "expired" | "error"
                - access_token:（僅成功時）
                - username:（僅成功時）
                - error:（僅錯誤時）
        """
        logger.info(f"[GitHub 驗證] 正在輪詢 token，device_code: {device_code[:8]}...")

        if not self.client_id:
            logger.error("[GitHub 驗證] 未設定 Client ID", exc_info=True)
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
                logger.error(f"[GitHub 驗證] 輪詢失敗: HTTP {response.status_code}", exc_info=True)
                return {"status": "error", "error": f"HTTP {response.status_code}"}

            data = response.json()
            # 避免記錄敏感欄位如 access_token。
            logger.info(f"[GitHub 驗證] 輪詢回應狀態: {data.get('error') or 'success'}")

            # 檢查錯誤
            error = data.get("error")
            if error == "authorization_pending":
                logger.info("[GitHub 驗證] 授權等待中...")
                return {"status": "pending"}
            elif error == "slow_down":
                new_interval = data.get("interval", 10)
                logger.info(f"[GitHub 驗證] 速率受限，降速至 {new_interval} 秒間隔")
                return {"status": "pending", "slow_down": True, "interval": new_interval}
            elif error == "expired_token":
                logger.warning("[GitHub 驗證] Device code 已過期")
                return {"status": "expired", "error": "Device code expired"}
            elif error == "access_denied":
                logger.warning("[GitHub 驗證] 使用者拒絕授權")
                return {"status": "error", "error": "User denied access"}
            elif error:
                logger.error(f"[GitHub 驗證] 未知錯誤: {error}", exc_info=True)
                return {"status": "error", "error": error}

            # 成功！已取得 access token
            access_token = data.get("access_token")
            if not access_token:
                return {"status": "error", "error": "No access token in response"}

            # 取得使用者資訊
            username = await self._get_username(access_token)

            # 將 token 與使用者名稱儲存至資料庫
            set_setting(AppSettingKey.GITHUB_TOKEN, access_token)
            if username:
                set_setting(AppSettingKey.GITHUB_USERNAME, username)

            # 重設 GitHub 服務以使用新 token
            reset_github_service()

            logger.info(f"[GitHub 驗證] GitHub 已成功連結，帳號: @{username}")

            return {
                "status": "success",
                "access_token": access_token,
                "username": username,
            }

    @staticmethod
    async def _get_username(token: str) -> Optional[str]:
        """取得 token 對應的 GitHub 使用者名稱。"""
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
        取得目前的 GitHub 連線狀態。
        檢查是否有有效的 token 並回傳使用者資訊。
        """
        token = get_setting(AppSettingKey.GITHUB_TOKEN)

        if not token:
            return ConnectionStatus(connected=False)

        # 透過檢查速率限制驗證 token 是否仍有效
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
                    # Token 無效，清理資料
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
                    connected=False,  # 逾時，無法驗證連線
                    username=get_setting(AppSettingKey.GITHUB_USERNAME),
                    error="Connection timeout"
                )
            except httpx.RequestError as e:
                return ConnectionStatus(
                    connected=False,  # 網路錯誤，無法驗證連線
                    username=get_setting(AppSettingKey.GITHUB_USERNAME),
                    error=f"Network error: {str(e)}"
                )

    @staticmethod
    def disconnect() -> bool:
        """
        移除已儲存的憑證以中斷 GitHub 連結。
        憑證已移除回傳 True，不存在回傳 False。
        """
        token_deleted = delete_setting(AppSettingKey.GITHUB_TOKEN)
        delete_setting(AppSettingKey.GITHUB_USERNAME)

        # 重設 GitHub 服務
        reset_github_service()

        if token_deleted:
            logger.info("[GitHub 驗證] GitHub 已成功斷開連結")

        return token_deleted


# 模組層級 singleton
_auth_service: Optional[GitHubAuthService] = None


def get_github_auth_service() -> GitHubAuthService:
    """取得 GitHub 驗證服務的 singleton 實例。"""
    global _auth_service
    if _auth_service is None:
        _auth_service = GitHubAuthService()
    return _auth_service
