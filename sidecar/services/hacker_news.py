"""
Hacker News API 服務。
使用 Algolia HN Search API 搜尋 repo 提及。
API: https://hn.algolia.com/api
"""

import logging
import re
import threading
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

from constants import HN_API_TIMEOUT_SECONDS

logger = logging.getLogger(__name__)

HN_SEARCH_API = "https://hn.algolia.com/api/v1/search"


class HackerNewsAPIError(Exception):
    """HN API 錯誤的自訂例外。"""
    def __init__(self, message: str, status_code: int | None = None) -> None:
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


# repo 名字本身是普通英文字時，裸名匹配會撈進一整批毫不相干的熱門故事——
# 而且它們分數高，會直接霸佔儀表板的前幾名。實測命中的例子：
#   TheAlgorithms/Java        <- Google's copying of the Java SE API was fair use
#   TheAlgorithms/Python      <- Uv is the best thing to happen to the Python ecosystem
#   modelcontextprotocol/registry <- ...leaked via a map file in their NPM registry
#   mattpocock/skills         <- Tech sector job interviews assess anxiety, not software skills
# 這類名字要求故事同時提到 owner 才算數。名單寧可漏列也不要誤列：漏列只是少擋掉
# 一些雜訊，誤列會讓真正的提及消失。發現新的就加進來。
# 只收「幾乎不會是某個專案完整身分」的字。像 react、mermaid、stagehand、godot
# 這種本身就是專案識別的名字不列——實測列進去會把
# 「Show HN: Stagehand – the open source SDK for browser agents」這種真正的提及刪掉。
# 語言名（java、python…）留著是安全的：官方 repo 多半是 rust-lang/rust、ruby/ruby
# 這種 owner 含自己名字的形式，會先被下面的例外放行。
GENERIC_REPO_NAMES = frozenset({
    # 常被借用的語言名。名為 Java／Python 但 owner 無關的，多半是教材彙整類 repo
    "java", "python", "ruby", "scala", "perl", "php", "kotlin",
    # 一般名詞
    "registry", "skills", "core", "common", "shared", "utils", "tools", "docs",
    "examples", "samples", "templates", "starter", "boilerplate", "framework",
    "library", "engine", "platform", "service", "server", "client", "gateway",
    "proxy", "cache", "queue", "stream", "graph", "chart", "table", "form",
    "theme", "layout", "grid", "list", "menu", "modal", "dialog", "badge",
    "card", "panel", "tree", "path", "route", "page", "view", "model", "data",
    "store", "state", "action", "event", "hook", "plugin", "module", "package",
    "bundle", "build", "deploy", "release", "version", "branch", "commit",
    "patch", "merge", "issue", "task", "job", "work", "flow", "chain", "block",
    "batch", "item", "entry", "record", "field", "value", "name", "type",
    "class", "method", "config", "console", "portal", "studio", "workshop",
    "playground", "sandbox", "notebook", "album", "agent", "monitor",
})

# 詞邊界：不能用子字串。實測 Java 會命中 JavaScript，名為 cas 的 repo 會命中
# case / Cassette / cashflow / cashless——那 40 筆訊號沒有一筆是對的。
_BOUNDARY = r"(?<![0-9a-z]){}(?![0-9a-z])"


def _mentions(term: str, haystack: str) -> bool:
    """term 是否以完整詞的形式出現在 haystack（兩者都必須已轉小寫）。"""
    return re.search(_BOUNDARY.format(re.escape(term)), haystack) is not None


def _mentions_project(name: str, haystack: str) -> bool:
    """比 _mentions 多認一種寫法：直接把 JS 接在後面的 MermaidJS、VueJS。

    「mermaid.js」本來就過得了（點號不是字母），過不了的是黏在一起那種，
    而實測就是這樣把「Sequence Diagrams in MermaidJS」判成不相關的。
    """
    return _mentions(name, haystack) or _mentions(f"{name}js", haystack)


def _is_generic_name(name: str) -> bool:
    """名字短到或普通到不足以單獨識別一個專案。"""
    return len(name) <= 4 or name in GENERIC_REPO_NAMES


def is_relevant_story(title: str, url: str, owner: str, name: str) -> bool:
    """這則 HN 故事是否真的在講這個 repo。

    兩個條件：名字必須以完整的詞出現；名字若是普通字，故事還得同時提到 owner。

    指向 github.com/owner/name 的連結會自動滿足這兩者——URL 裡的斜線讓 owner 與
    name 各自成為獨立的詞——所以不必為「有連結」或「出現完整 owner/name」另外開一層。
    寫成獨立的分支看起來比較周全，但沒有任何輸入會因此得到不同結果。
    """
    hay = f"{title} {url}".lower()
    owner_l, name_l = owner.lower(), name.lower()

    if not _mentions_project(name_l, hay):
        return False
    # owner 名稱本身就含 repo 名時（godotengine/godot、ruby-lang/ruby、n8n-io/n8n），
    # 要求 owner 出現不會多提供任何證據——這種專案就是以自己的名字為識別
    if name_l in owner_l:
        return True
    return not _is_generic_name(name_l) or _mentions(owner_l, hay)


def _parse_hn_hit(hit: dict, seen_ids: set) -> HNStory | None:
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
    seen_ids: set[str],
) -> tuple[list[HNStory], list[str]]:
    """執行單一 HN 搜尋查詢，回傳 (stories, errors)。"""
    stories: list[HNStory] = []
    errors: list[str] = []
    try:
        response = await client.get(
            HN_SEARCH_API,
            params={"query": query, "tags": "story", "hitsPerPage": 20}
        )

        if response.status_code == 429:
            logger.warning("[HN] API 速率限制已超出")
            return stories, ["Rate limit exceeded"]

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
    return stories, errors


class HackerNewsService:
    """透過 Algolia API 搜尋 Hacker News 的服務。"""

    def __init__(self, timeout: float = HN_API_TIMEOUT_SECONDS) -> None:
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None

    @property
    def client(self) -> httpx.AsyncClient:
        """取得共用的 httpx.AsyncClient（連線池復用）。

        每次呼叫都開新 client 等於每次都重跑一次 TLS 握手。整批掃描時這是主要成本：
        94 個 repo × 2 次查詢實測 104 秒，光是改成共用連線就降到 80 秒。
        """
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        return self._client

    async def aclose(self) -> None:
        """關閉底層 HTTP client。"""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def search_repo(self, repo_name: str, owner: str) -> list[HNStory]:
        """
        搜尋 HN 上關於 repo 的提及。
        同時搜尋 "owner/repo" 與 "repo" 名稱，
        並過濾掉標題或 URL 中未實際包含 repo 名稱的模糊匹配結果。

        Args:
            repo_name: repo 名稱
            owner: repo 擁有者

        Returns:
            HNStory 物件列表

        Raises:
            HackerNewsAPIError: 僅在所有查詢皆失敗時拋出
        """
        stories: list[HNStory] = []
        seen_ids: set[str] = set()
        errors: list[str] = []

        # 先搜尋完整名稱（更精確），再搜尋 repo 名稱
        queries = [f"{owner}/{repo_name}", repo_name]

        client = self.client
        for query in queries:
            new_stories, new_errors = await _execute_hn_query(client, query, seen_ids)
            stories.extend(new_stories)
            errors.extend(new_errors)

        # 僅在所有查詢失敗且無結果時拋出錯誤
        if not stories and errors:
            raise HackerNewsAPIError(f"All queries failed: {'; '.join(errors)}")

        # 過濾 Algolia 模糊匹配的假結果，規則見 is_relevant_story
        before_count = len(stories)
        stories = [
            s for s in stories
            if is_relevant_story(s.title, s.url, owner, repo_name)
        ]
        filtered_count = before_count - len(stories)
        if filtered_count > 0:
            # DEBUG 而非 INFO：Algolia 的模糊匹配本來就會帶回不相關的結果，過濾掉是
            # 每一次、每一個 repo 都會發生的常態。追蹤上百個 repo 時，這行會在每半小時
            # 產生上百筆 INFO，把真正需要注意的訊息淹掉。
            logger.debug(
                f"[HN] 過濾了 {filtered_count} 筆與 {owner}/{repo_name} 不相關的模糊匹配結果"
            )

        # 依分數排序（最高優先）
        stories.sort(key=lambda s: s.points, reverse=True)

        return stories


# 模組層級便利函式
_default_service: HackerNewsService | None = None
_hn_service_lock = threading.Lock()


def get_hn_service() -> HackerNewsService:
    """取得預設的 HN 服務實例（thread-safe double-checked locking）。"""
    global _default_service
    if _default_service is None:
        with _hn_service_lock:
            if _default_service is None:
                _default_service = HackerNewsService()
    return _default_service


async def close_hn_service() -> None:
    """關閉預設 HN service 的 HTTP client（用於應用程式關閉時）。

    client 現在活過單次呼叫，所以得有人負責關掉它，否則關機時會留下未關閉的連線。
    """
    global _default_service
    with _hn_service_lock:
        service = _default_service
        _default_service = None
    if service:
        await service.aclose()


async def fetch_hn_mentions(owner: str, repo_name: str) -> list[HNStory] | None:
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
    except (httpx.RequestError, httpx.HTTPStatusError, KeyError, ValueError) as e:
        logger.error(f"[HN] 抓取 {owner}/{repo_name} HN 提及時發生非預期錯誤: {e}", exc_info=True)
        return None
