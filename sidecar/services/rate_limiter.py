"""
外部 API 呼叫的速率限制與重試工具。
使用 tenacity 實現帶 jitter 的指數退避。
"""

from __future__ import annotations

import logging
from typing import TypeVar, Callable, Awaitable

from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential_jitter,
    retry_if_exception,
    before_sleep_log,
    RetryError,
)

from services.github import (
    GitHubService,
    GitHubRateLimitError,
    GitHubAPIError,
    GitHubNotFoundError,
)

logger = logging.getLogger(__name__)

T = TypeVar("T")


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


def create_github_retry_decorator(max_attempts: int = 5):
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


async def batch_fetch_with_retry(
    github: GitHubService,
    repos: "list[tuple[str, str]]",
    on_success: "Callable[[str, str, dict], Awaitable[None]] | None" = None,
    on_failure: "Callable[[str, str, Exception], Awaitable[None]] | None" = None,
) -> "dict[str, dict | None]":
    """
    批次抓取多個 repo，每個皆附帶重試邏輯。

    Args:
        github: GitHubService 實例
        repos: (owner, name) tuple 列表
        on_success: 成功抓取的非同步 callback
        on_failure: 失敗抓取（重試後）的非同步 callback

    Returns:
        "owner/name" 對應 repo 資料（失敗為 None）的字典
    """
    results: "dict[str, dict | None]" = {}

    for owner, name in repos:
        full_name = f"{owner}/{name}"
        try:
            data = await fetch_repo_with_retry(github, owner, name)
            results[full_name] = data
            if on_success:
                await on_success(owner, name, data)
            logger.debug(f"[速率限制] 已成功抓取 {full_name}")
        except RetryError as e:
            # 所有重試已耗盡
            results[full_name] = None
            if on_failure:
                await on_failure(owner, name, e.last_attempt.exception())
            logger.error(f"[速率限制] 所有重試後仍無法抓取 {full_name}: {e}", exc_info=True)
        except Exception as e:
            # 不可重試的錯誤（例如 GitHubNotFoundError）
            results[full_name] = None
            if on_failure:
                await on_failure(owner, name, e)
            logger.warning(f"[速率限制] 抓取 {full_name} 失敗: {e}")

    return results
