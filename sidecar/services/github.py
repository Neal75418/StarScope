"""
GitHub API 服務。
負責從 GitHub 取得 repo 資料。
"""

import logging
import os
import threading
import httpx
from typing import Optional
from sqlalchemy.exc import SQLAlchemyError
from keyring.errors import KeyringError

from constants import GITHUB_API_TIMEOUT_SECONDS, GITHUB_TOKEN_ENV_VAR
from db.models import AppSettingKey

logger = logging.getLogger(__name__)

GITHUB_API_BASE = "https://api.github.com"


# 例外類別
class GitHubAPIError(Exception):
    """GitHub API 錯誤的自訂例外。"""
    def __init__(self, message: str, status_code: Optional[int] = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class GitHubRateLimitError(GitHubAPIError):
    """GitHub API 速率限制超過時拋出。"""
    def __init__(self, message: str, status_code: Optional[int] = None, reset_at: Optional[int] = None) -> None:
        super().__init__(message, status_code)
        self.reset_at = reset_at  # Unix timestamp of rate limit reset


class GitHubNotFoundError(GitHubAPIError):
    """找不到 repo 時拋出。"""
    pass


# GitHub API 請求的共用工具
def build_github_headers(token: Optional[str] = None) -> dict:
    """建立標準 GitHub API headers。"""
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def handle_github_response(
    response: "httpx.Response",
    raise_on_error: bool = True,
    context: str = ""
) -> Optional[dict]:
    """
    處理 GitHub API 回應，含標準錯誤檢查。

    Args:
        response: httpx 回應物件
        raise_on_error: 為 True 時拋出例外；為 False 時錯誤回傳 None
        context: 錯誤訊息的上下文字串（例如 "owner/repo"）

    Returns:
        JSON 回應字典，或若 raise_on_error=False 且發生錯誤則為 None

    Raises:
        GitHubNotFoundError: 404 且 raise_on_error=True 時
        GitHubRateLimitError: 403 且 raise_on_error=True 時
        GitHubAPIError: 401 或其他錯誤且 raise_on_error=True 時
    """
    if response.status_code == 404:
        if raise_on_error:
            raise GitHubNotFoundError(
                f"Resource not found: {context}" if context else "Resource not found",
                status_code=404
            )
        return None

    if response.status_code == 403:
        remaining = response.headers.get("X-RateLimit-Remaining", "unknown")
        reset_at_raw = response.headers.get("X-RateLimit-Reset")
        reset_at = int(reset_at_raw) if reset_at_raw else None
        if raise_on_error:
            raise GitHubRateLimitError(
                f"GitHub API rate limit exceeded (remaining: {remaining})",
                status_code=403,
                reset_at=reset_at,
            )
        logger.warning(f"[GitHub API] 速率限制或禁止存取: {context}")
        return None

    if response.status_code == 401:
        if raise_on_error:
            raise GitHubAPIError(
                "GitHub API authentication failed - check token",
                status_code=401
            )
        logger.error("[GitHub API] GitHub API 驗證失敗", exc_info=True)
        return None

    response.raise_for_status()
    return response.json()


class GitHubService:
    def __init__(self, token: Optional[str] = None, timeout: float = GITHUB_API_TIMEOUT_SECONDS) -> None:
        self.token = token
        self.timeout = timeout
        self.headers = build_github_headers(token)

    async def get_repo(self, owner: str, repo: str) -> dict:
        """
        取得 repo 資訊。

        Raises:
            GitHubNotFoundError: 找不到 repo（404）
            GitHubRateLimitError: 速率限制超過（403）
            GitHubAPIError: 其他 API 錯誤
        """
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                f"{GITHUB_API_BASE}/repos/{owner}/{repo}",
                headers=self.headers,
            )
            return handle_github_response(
                response,
                raise_on_error=True,
                context=f"{owner}/{repo}"
            )

    async def get_repo_stargazers_count(self, owner: str, repo: str) -> int:
        """
        取得 repo 目前的 star 數。
        """
        data = await self.get_repo(owner, repo)
        return data.get("stargazers_count", 0)

    async def get_commit_activity(
        self, owner: str, repo: str, max_retries: int = 3
    ) -> list[dict]:
        """
        取得過去一年的每週 commit 活動。

        GitHub Stats API 計算統計時可能回傳 202。
        我們以指數退避重試直到資料就緒。

        Returns:
            每週資料列表：[{week: timestamp, total: int, days: [int x 7]}]
            資料不可用時回傳空列表。

        Raises:
            GitHubNotFoundError: 找不到 repo
            GitHubRateLimitError: 速率限制超過
            GitHubAPIError: 其他 API 錯誤
        """
        import asyncio

        url = f"{GITHUB_API_BASE}/repos/{owner}/{repo}/stats/commit_activity"

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            for attempt in range(max_retries):
                response = await client.get(url, headers=self.headers)

                # 202 表示 GitHub 正在計算統計，延遲後重試
                if response.status_code == 202:
                    if attempt < max_retries - 1:
                        delay = 2 ** attempt  # 1s, 2s, 4s
                        logger.info(
                            f"[GitHub API] GitHub 正在計算 {owner}/{repo} 的統計資料，"
                            f"{delay} 秒後重試 (第 {attempt + 1}/{max_retries} 次)"
                        )
                        await asyncio.sleep(delay)
                        continue
                    # 已達最大重試次數，回傳空列表
                    logger.warning(
                        f"[GitHub API] {owner}/{repo} 的統計資料在 {max_retries} 次嘗試後仍未就緒"
                    )
                    return []

                # 204 表示無內容（空 repo）
                if response.status_code == 204:
                    return []

                # 處理標準回應
                data = handle_github_response(
                    response, raise_on_error=True, context=f"{owner}/{repo}/stats/commit_activity"
                )
                return list(data) if data else []

        return []

    async def get_languages(self, owner: str, repo: str) -> dict[str, int]:
        """
        取得 repo 的語言統計。

        Returns:
            語言名稱對應程式碼位元組數的字典：{"Python": 123456, ...}
            不可用時回傳空字典。

        Raises:
            GitHubNotFoundError: 找不到 repo
            GitHubRateLimitError: 速率限制超過
            GitHubAPIError: 其他 API 錯誤
        """
        url = f"{GITHUB_API_BASE}/repos/{owner}/{repo}/languages"

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(url, headers=self.headers)
            data = handle_github_response(
                response, raise_on_error=True, context=f"{owner}/{repo}/languages"
            )
            return data if data else {}

    async def search_repos(
        self,
        query: str,
        language: Optional[str] = None,
        min_stars: Optional[int] = None,
        topic: Optional[str] = None,
        sort: str = "stars",
        order: str = "desc",
        page: int = 1,
        per_page: int = 20,
    ) -> dict:
        """
        使用 Search API 搜尋 GitHub repo。

        Args:
            query: 搜尋查詢字串
            language: 依程式語言篩選
            min_stars: 依最低 star 數篩選
            topic: 依 topic 篩選
            sort: 排序欄位（stars、forks、updated）
            order: 排序方向（asc、desc）
            page: 頁碼（從 1 開始）
            per_page: 每頁筆數（最大 100）

        Returns:
            GitHub Search API 回應，含 items 與 total_count

        Raises:
            GitHubRateLimitError: 速率限制超過（Search API：30/min）
            GitHubAPIError: 其他 API 錯誤
        """
        # 組合查詢與篩選條件
        q_parts = [query]
        if language:
            q_parts.append(f"language:{language}")
        if min_stars is not None and min_stars > 0:
            q_parts.append(f"stars:>={min_stars}")
        if topic:
            q_parts.append(f"topic:{topic}")

        full_query = " ".join(q_parts)

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                f"{GITHUB_API_BASE}/search/repositories",
                headers=self.headers,
                params={
                    "q": full_query,
                    "sort": sort,
                    "order": order,
                    "page": page,
                    "per_page": per_page,
                },
            )
            return handle_github_response(
                response, raise_on_error=True, context=f"search: {query}"
            )

    async def get_stargazers_with_dates(
        self,
        owner: str,
        repo: str,
        max_stars: int = 5000,
        per_page: int = 100,
    ) -> list[dict]:
        """
        取得 repo 的 stargazer（含時間戳記）。

        使用特殊 Accept header 的 GitHub stargazers API 以取得時間戳記。
        限制 star 數 < max_stars 的 repo，避免耗盡速率限制。

        Args:
            owner: repo 擁有者
            repo: repo 名稱
            max_stars: 允許的最大 star 數（超過則拒絕）
            per_page: 每頁筆數（最大 100）

        Returns:
            Stargazer 列表：[{"starred_at": "2024-01-15T...", "user": {...}}, ...]
            超過 max_stars 限制時回傳空列表。

        Raises:
            GitHubNotFoundError: 找不到 repo
            GitHubRateLimitError: 速率限制超過
            GitHubAPIError: 其他 API 錯誤
        """
        # 先檢查 repo 是否超過 star 上限
        repo_data = await self.get_repo(owner, repo)
        star_count = repo_data.get("stargazers_count", 0)

        if star_count > max_stars:
            logger.warning(
                f"[GitHub API] {owner}/{repo} 有 {star_count} 顆星，"
                f"超過上限 {max_stars}，跳過 stargazers 抓取"
            )
            return []

        # 特殊 header 以取得 starred_at 時間戳記
        headers = {
            **self.headers,
            "Accept": "application/vnd.github.star+json",
        }

        all_stargazers: list[dict] = []
        max_pages = 100  # Safety limit: max 10,000 stars

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            for page in range(1, max_pages + 1):
                response = await client.get(
                    f"{GITHUB_API_BASE}/repos/{owner}/{repo}/stargazers",
                    headers=headers,
                    params={"per_page": per_page, "page": page},
                )

                data = handle_github_response(
                    response, raise_on_error=True, context=f"{owner}/{repo}/stargazers?page={page}"
                )

                if not data:
                    break

                all_stargazers.extend(data)

                if len(data) < per_page:
                    break
            else:
                logger.warning(f"[GitHub API] {owner}/{repo} stargazers 已達分頁上限")

        logger.info(f"[GitHub API] 已抓取 {owner}/{repo} 的 {len(all_stargazers)} 個 stargazers")
        return all_stargazers


# 供排程器使用的模組層級便利函式
_default_service: Optional[GitHubService] = None
_service_lock = threading.Lock()


def _resolve_github_token() -> Optional[str]:
    """從資料庫（OAuth）或環境變數解析 GitHub token。"""
    try:
        from services.settings import get_setting
        token = get_setting(AppSettingKey.GITHUB_TOKEN)
        if token:
            logger.info("[GitHub API] 使用資料庫中的 GitHub token (OAuth)")
            return token
    except (SQLAlchemyError, KeyringError) as e:
        logger.debug(f"[GitHub API] 無法從資料庫/Keyring 讀取 token: {e}")
    except Exception as e:
        logger.warning(f"[GitHub API] 讀取 token 未預期錯誤，回退至環境變數: {e}")

    token = os.getenv(GITHUB_TOKEN_ENV_VAR)
    if token:
        logger.info("[GitHub API] 使用環境變數中的 GitHub token")
    return token


def get_github_service() -> GitHubService:
    """
    取得預設的 GitHub service 實例。

    Token 優先順序：
    1. 資料庫（來自 OAuth Device Flow）
    2. 環境變數（舊版回退）

    服務在應用程式生命週期內以 singleton 快取。
    Token 變更時呼叫 reset_github_service() 以刷新。
    """
    global _default_service
    if _default_service is None:
        with _service_lock:
            if _default_service is None:
                _default_service = GitHubService(token=_resolve_github_token())
    return _default_service


def reset_github_service() -> None:
    """
    重設預設的 GitHub service 實例。

    用於測試或 token 需要刷新時。
    """
    global _default_service
    with _service_lock:
        _default_service = None


async def fetch_repo_data(owner: str, repo: str) -> Optional[dict]:
    """
    從 GitHub 取得 repo 資料。
    請求失敗時回傳 None。
    """
    try:
        service = get_github_service()
        return await service.get_repo(owner, repo)
    except GitHubNotFoundError:
        logger.warning(f"[GitHub API] 找不到 repo: {owner}/{repo}")
        return None
    except GitHubRateLimitError as e:
        logger.error(f"[GitHub API] GitHub 速率限制已超出: {e}", exc_info=True)
        return None
    except GitHubAPIError as e:
        logger.error(f"[GitHub API] {owner}/{repo} API 錯誤: {e}", exc_info=True)
        return None
    except httpx.TimeoutException:
        logger.error(f"[GitHub API] 抓取 {owner}/{repo} 逾時", exc_info=True)
        return None
    except httpx.RequestError as e:
        logger.error(f"[GitHub API] 抓取 {owner}/{repo} 網路錯誤: {e}", exc_info=True)
        return None
