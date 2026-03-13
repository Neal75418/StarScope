"""
外部 API 呼叫的速率限制與重試工具。
使用 tenacity 實現帶 jitter 的指數退避。
"""

from __future__ import annotations

import logging
from typing import Any


from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential_jitter,
    retry_if_exception,
    before_sleep_log,
)

from services.github import (
    GitHubService,
    GitHubRateLimitError,
    GitHubAPIError,
    GitHubNotFoundError,
)

logger = logging.getLogger(__name__)


def _should_retry_github_error(exception: BaseException) -> bool:
    """
    判斷 GitHub 錯誤是否應觸發重試。

    會重試：
    - GitHubRateLimitError (403) — 暫時性速率限制
    - GitHubAPIError (5xx 等) — 暫時性伺服器錯誤

    不重試：
    - GitHubNotFoundError (404) — 資源不存在，重試無意義
    """
    if isinstance(exception, GitHubNotFoundError):
        return False
    return isinstance(exception, (GitHubRateLimitError, GitHubAPIError))


def create_github_retry_decorator(max_attempts: int = 5) -> Any:
    """
    為 GitHub API 呼叫建立重試裝飾器。

    使用帶 jitter 的指數退避：
    - 初始等待：4 秒
    - 最大等待：60 秒
    - Jitter：隨機變化以避免 thundering herd

    會重試：
    - GitHubRateLimitError (403)
    - GitHubAPIError（暫時性錯誤，排除 404）
    """
    return retry(
        retry=retry_if_exception(_should_retry_github_error),
        wait=wait_exponential_jitter(initial=4, max=60, jitter=2),
        stop=stop_after_attempt(max_attempts),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )


# 預先配置的常用裝飾器
github_retry = create_github_retry_decorator()


@github_retry
async def fetch_repo_with_retry(github: GitHubService, owner: str, name: str) -> dict:
    """
    抓取 repo 資料，遇到速率限制或暫時性錯誤時自動重試。

    Args:
        github: GitHubService 實例
        owner: repo 擁有者
        name: repo 名稱

    Returns:
        GitHub API 回傳的 repo 資料字典

    Raises:
        GitHubNotFoundError: 找不到 repo（不重試）
        GitHubRateLimitError: 重試次數耗盡後拋出
        GitHubAPIError: 重試次數耗盡後拋出
    """
    return await github.get_repo(owner, name)
