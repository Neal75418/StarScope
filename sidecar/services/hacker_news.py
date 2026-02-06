"""
Hacker News API 服務。
使用 Algolia HN Search API 搜尋 repo 提及。
API: https://hn.algolia.com/api
"""

import logging
from typing import Optional, List
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

from constants import HN_API_TIMEOUT_SECONDS

logger = logging.getLogger(__name__)

HN_SEARCH_API = "https://hn.algolia.com/api/v1/search"


class HackerNewsAPIError(Exception):
    """HN API 錯誤的自訂例外。"""
    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


@dataclass
class HNStory:
    """已解析的 Hacker News 文章。"""
    object_id: str
    title: str
    url: str
    points: int
    num_comments: int
    author: str
    created_at: datetime


def _parse_created_at(created_at_str: str) -> datetime:
    """將 HN 時間戳記解析為 datetime。"""
    try:
        return datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return datetime.now(timezone.utc)


def _parse_hn_hit(hit: dict, seen_ids: set) -> Optional[HNStory]:
    """將單一 HN API 結果解析為 HNStory，無效或重複時回傳 None。"""
    object_id = hit.get("objectID")
    if not object_id or object_id in seen_ids:
        return None

    seen_ids.add(object_id)

    created_at = _parse_created_at(hit.get("created_at", ""))
    story_url = hit.get("url") or f"https://news.ycombinator.com/item?id={object_id}"

    return HNStory(
        object_id=object_id,
        title=hit.get("title", ""),
        url=story_url,
        points=hit.get("points") or 0,
        num_comments=hit.get("num_comments") or 0,
        author=hit.get("author", ""),
        created_at=created_at,
    )


async def _execute_hn_query(
    client: httpx.AsyncClient,
    query: str,
    seen_ids: set,
    stories: List[HNStory],
    errors: List[str]
) -> None:
    """執行單一 HN 搜尋查詢並附加結果。"""
    try:
        response = await client.get(
            HN_SEARCH_API,
            params={"query": query, "tags": "story", "hitsPerPage": 20}
        )

        if response.status_code == 429:
            logger.warning("[HN] API 速率限制已超出")
            errors.append("Rate limit exceeded")
            return

        response.raise_for_status()
        data = response.json()

        for hit in data.get("hits", []):
            story = _parse_hn_hit(hit, seen_ids)
            if story:
                stories.append(story)

    except httpx.TimeoutException:
        logger.warning(f"[HN] API 查詢逾時: {query}")
        errors.append(f"Timeout for {query}")
    except httpx.RequestError as e:
        logger.warning(f"[HN] API 請求錯誤 ({query}): {e}")
        errors.append(str(e))
    except httpx.HTTPStatusError as e:
        logger.warning(f"[HN] API HTTP 錯誤 ({query}): {e}")
        errors.append(f"HTTP {e.response.status_code}")


class HackerNewsService:
    """透過 Algolia API 搜尋 Hacker News 的服務。"""

    def __init__(self, timeout: float = HN_API_TIMEOUT_SECONDS):
        self.timeout = timeout

    async def search_repo(self, repo_name: str, owner: str) -> List[HNStory]:
        """
        搜尋 HN 上關於 repo 的提及。
        同時搜尋 "owner/repo" 與 "repo" 名稱。

        Args:
            repo_name: repo 名稱
            owner: repo 擁有者

        Returns:
            HNStory 物件列表

        Raises:
            HackerNewsAPIError: 僅在所有查詢皆失敗時拋出
        """
        stories: List[HNStory] = []
        seen_ids: set = set()
        errors: List[str] = []

        # 先搜尋完整名稱（更精確），再搜尋 repo 名稱
        queries = [f"{owner}/{repo_name}", repo_name]

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            for query in queries:
                await _execute_hn_query(client, query, seen_ids, stories, errors)

        # 僅在所有查詢失敗且無結果時拋出錯誤
        if not stories and errors:
            raise HackerNewsAPIError(f"All queries failed: {'; '.join(errors)}")

        # 依分數排序（最高優先）
        stories.sort(key=lambda s: s.points, reverse=True)

        return stories


# 模組層級便利函式
_default_service: Optional[HackerNewsService] = None


def get_hn_service() -> HackerNewsService:
    """取得預設的 HN 服務實例。"""
    global _default_service
    if _default_service is None:
        _default_service = HackerNewsService()
    return _default_service


async def fetch_hn_mentions(owner: str, repo_name: str) -> Optional[List[HNStory]]:
    """
    抓取 repo HN 提及的便利函式。
    請求失敗時回傳 None。
    """
    try:
        service = get_hn_service()
        return await service.search_repo(repo_name, owner)
    except HackerNewsAPIError as e:
        logger.error(f"[HN] 抓取 {owner}/{repo_name} HN 提及失敗: {e}", exc_info=True)
        return None
    except Exception as e:
        logger.error(f"[HN] 抓取 {owner}/{repo_name} HN 提及時發生非預期錯誤: {e}", exc_info=True)
        return None
