"""
Rate limiting and retry utilities for external API calls.
Uses tenacity for exponential backoff with jitter.
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
    Determine if a GitHub error should trigger a retry.

    Retries on:
    - GitHubRateLimitError (403) - transient rate limiting
    - GitHubAPIError (5xx, etc.) - transient server errors

    Does NOT retry on:
    - GitHubNotFoundError (404) - resource doesn't exist, retrying won't help
    """
    if isinstance(exception, GitHubNotFoundError):
        return False
    return isinstance(exception, (GitHubRateLimitError, GitHubAPIError))


def create_github_retry_decorator(max_attempts: int = 5):
    """
    Create a retry decorator for GitHub API calls.

    Uses exponential backoff with jitter:
    - Initial wait: 4 seconds
    - Max wait: 60 seconds
    - Jitter: random variation to prevent thundering herd

    Retries on:
    - GitHubRateLimitError (403)
    - GitHubAPIError (transient errors, excluding 404)
    """
    return retry(
        retry=retry_if_exception(_should_retry_github_error),
        wait=wait_exponential_jitter(initial=4, max=60, jitter=2),
        stop=stop_after_attempt(max_attempts),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )


# Pre-configured decorator for common use
github_retry = create_github_retry_decorator()


@github_retry
async def fetch_repo_with_retry(github: GitHubService, owner: str, name: str) -> dict:
    """
    Fetch repository data with automatic retry on rate limit or transient errors.

    Args:
        github: GitHubService instance
        owner: Repository owner
        name: Repository name

    Returns:
        Repository data dict from GitHub API

    Raises:
        GitHubNotFoundError: Repository not found (not retried)
        GitHubRateLimitError: After max retries exhausted
        GitHubAPIError: After max retries exhausted
    """
    return await github.get_repo(owner, name)


async def batch_fetch_with_retry(
    github: GitHubService,
    repos: "list[tuple[str, str]]",
    on_success: "Callable[[str, str, dict], Awaitable[None]] | None" = None,
    on_failure: "Callable[[str, str, Exception], Awaitable[None]] | None" = None,
) -> "dict[str, dict | None]":
    """
    Fetch multiple repositories with retry logic for each.

    Args:
        github: GitHubService instance
        repos: List of (owner, name) tuples
        on_success: Async callback for successful fetches
        on_failure: Async callback for failed fetches (after retries)

    Returns:
        Dict mapping "owner/name" to repo data (or None if failed)
    """
    results: "dict[str, dict | None]" = {}

    for owner, name in repos:
        full_name = f"{owner}/{name}"
        try:
            data = await fetch_repo_with_retry(github, owner, name)
            results[full_name] = data
            if on_success:
                await on_success(owner, name, data)
            logger.debug(f"Successfully fetched {full_name}")
        except RetryError as e:
            # All retries exhausted
            results[full_name] = None
            if on_failure:
                await on_failure(owner, name, e.last_attempt.exception())
            logger.error(f"Failed to fetch {full_name} after all retries: {e}")
        except Exception as e:
            # Non-retryable errors (e.g., GitHubNotFoundError)
            results[full_name] = None
            if on_failure:
                await on_failure(owner, name, e)
            logger.warning(f"Failed to fetch {full_name}: {e}")

    return results
