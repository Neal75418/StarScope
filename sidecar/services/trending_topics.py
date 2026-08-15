"""熱門主題建議。

回答的問題是「現在有哪些主題正在升溫，而我想不到要把它加進興趣清單」——
所以它刻意不從使用者既有的興趣或 star 推導（那只會回傳已經在圈內的東西），
而是直接看世界上最近冒出來的新專案在標什麼。

方法（每一條都是實測後留下的，不是設計時的猜測）：

1. 取兩個切面：最近 60 天建立、①≥100 星（頭部）②30–99 星（長尾）。
   實測過第三個切面「最近更新排序」——它量到的是 commit 頻率而非興趣，
   前 20 名有一半是漫畫下載器，所以不用。
2. 取兩個切面的交集，濾掉只在單一切面爆發的假象。
3. 依「升溫比值」＝ 樣本用量 ÷ 全站總量 排序。只看樣本用量會讓
   ai / python / typescript 這種通用詞霸榜，但它們當搜尋條件毫無鑑別度。
   （用「全站總量超過 N 就排除」試過，那會誤殺 mcp、claude-code 這些
   使用者實際上最好用的詞——絕對數量是錯的訊號，比值才是。）
4. 不做硬性排除、不強調名次：31 vs 30 的差距在雜訊內，排名會給人虛假的精確感。
   使用者自己看數字決定要不要加。

全站總量變動很慢（typescript 有 40 萬個 repo，明天不會變 39 萬），
所以與樣本分開快取、有效期長得多，穩定後每次重算只需查少數新候選詞。
"""

import asyncio
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass, asdict
from datetime import date, timedelta

from sqlalchemy.orm import Session

from db.models import AppSettingKey, Interest
from services.github import GitHubService
from services.settings import get_setting, set_setting
from utils.time import utc_now

logger = logging.getLogger(__name__)

# 取樣範圍
SAMPLE_DAYS = 60
PAGES_PER_FACET = 3
HEAD_FACET = ">=100"
TAIL_FACET = "30..99"
# 交集後依樣本用量取前 N 個去查全站總量（每個要一次搜尋請求，故設上限）
MAX_CANDIDATES = 30
# 回傳給前端的數量
RESULT_SIZE = 20
# 全站總量的快取壽命
GLOBAL_COUNT_TTL_DAYS = 7
# 兩次搜尋請求之間的間隔。GitHub 搜尋配額是 30 次/分鐘，本流程要打 6–36 次，
# 不節流就會在幾秒內撞上限（實測會直接回 429）。2.2 秒讓任何 60 秒窗口內
# 都不超過 27 次，留一點餘裕給同時進行的 feed 產生或使用者搜尋。
SEARCH_INTERVAL_SECONDS = 2.2


@dataclass
class TrendingTopic:
    """一個主題的取樣結果。

    刻意不含「是否已加入興趣清單」——那是興趣清單的狀態，不是主題的屬性，
    存進快取就會被凍結在重算的那一刻。見 with_membership()。
    """
    topic: str
    sample_count: int      # 最近 60 天新專案中有幾個標了這個 topic
    global_count: int      # 全 GitHub 有幾個 repo 標了它
    heat: float            # 升溫比值（每十萬個 repo 中有幾個是這波新的）


async def _paced_search(github: GitHubService, **kwargs) -> dict:
    """節流過的搜尋。每次呼叫前先等，確保不會突破每分鐘上限。"""
    await asyncio.sleep(SEARCH_INTERVAL_SECONDS)
    result: dict = await github.search_repos(**kwargs)
    return result


# 進度回報：(階段, 已完成, 總數)。階段是 "sampling" 或 "counting"。
# 這個操作首次要跑兩分鐘，期間前端只能顯示一句靜態文字，使用者無法分辨
# 「還在跑」與「卡住了」——實際發生過（使用者截圖來問「我點了你看一下」）。
ProgressFn = Callable[[str, int, int], None]

PHASE_SAMPLING = "sampling"
PHASE_COUNTING = "counting"


async def _sample_facet(
    github: GitHubService,
    star_range: str,
    created_after: str,
    on_progress: ProgressFn | None = None,
    done_offset: int = 0,
) -> dict[str, int]:
    """對單一切面取樣，回傳 {topic: 出現次數}。"""
    counts: dict[str, int] = {}
    for page in range(1, PAGES_PER_FACET + 1):
        result = await _paced_search(
            github,
            query=f"created:>{created_after} stars:{star_range}",
            sort="stars",
            order="desc",
            per_page=100,
            page=page,
        )
        for item in result.get("items", []):
            for topic in item.get("topics", []) or []:
                counts[topic] = counts.get(topic, 0) + 1
        if on_progress:
            on_progress(PHASE_SAMPLING, done_offset + page, PAGES_PER_FACET * 2)
    return counts


def _load_global_cache(db: Session) -> dict[str, int]:
    raw = get_setting(AppSettingKey.TRENDING_GLOBAL_COUNTS, db)
    if not raw:
        return {}
    try:
        payload = json.loads(raw)
        cached_at = date.fromisoformat(payload.get("cached_at", "1970-01-01"))
        if (utc_now().date() - cached_at).days > GLOBAL_COUNT_TTL_DAYS:
            return {}
        counts: dict[str, int] = payload.get("counts", {})
        return counts
    except Exception as e:  # 快取損毀不該讓功能整個壞掉
        logger.warning(f"[熱門主題] 全站總量快取無法解析，重新計算: {e}")
        return {}


def _save_global_cache(db: Session, counts: dict[str, int]) -> None:
    set_setting(
        AppSettingKey.TRENDING_GLOBAL_COUNTS,
        json.dumps({"cached_at": utc_now().date().isoformat(), "counts": counts}),
        db,
    )


async def compute_trending_topics(
    db: Session,
    github: GitHubService,
    on_progress: ProgressFn | None = None,
) -> list[TrendingTopic]:
    """重新計算熱門主題。

    內部已節流（見 SEARCH_INTERVAL_SECONDS），呼叫端不需要處理配額。
    首次計算約 80 秒；之後全站總量多半命中快取，只剩取樣的 6 次請求約 15 秒。
    """
    created_after = (utc_now().date() - timedelta(days=SAMPLE_DAYS)).isoformat()

    head = await _sample_facet(github, HEAD_FACET, created_after, on_progress, done_offset=0)
    tail = await _sample_facet(
        github, TAIL_FACET, created_after, on_progress, done_offset=PAGES_PER_FACET
    )

    # 交集：兩個切面都出現過才算數
    intersection = {t: head[t] + tail[t] for t in head if t in tail}
    if not intersection:
        logger.warning("[熱門主題] 兩個切面沒有交集，可能是搜尋回應異常")
        return []

    candidates = sorted(intersection.items(), key=lambda kv: -kv[1])[:MAX_CANDIDATES]

    global_counts = _load_global_cache(db)
    fetched_any = False
    # 只有未命中週快取的才需要查，所以總數要先算出來——否則進度條會停在
    # 「0/30」然後突然跳完（快取全中時實際上一次都不用查）
    to_fetch = [t for t, _ in candidates if t not in global_counts]
    if on_progress:
        on_progress(PHASE_COUNTING, 0, len(to_fetch))
    for idx, topic in enumerate(to_fetch, start=1):
        # 只要 total_count，per_page=1 讓回應最小
        probe = await _paced_search(github, query=f"topic:{topic}", per_page=1)
        total = int(probe.get("total_count", 0) or 0)
        if total > 0:
            global_counts[topic] = total
            fetched_any = True
        if on_progress:
            on_progress(PHASE_COUNTING, idx, len(to_fetch))
    if fetched_any:
        _save_global_cache(db, global_counts)

    results: list[TrendingTopic] = []
    for topic, sample_count in candidates:
        total = global_counts.get(topic, 0)
        if total <= 0:
            continue
        results.append(TrendingTopic(
            topic=topic,
            sample_count=sample_count,
            global_count=total,
            heat=round(sample_count / total * 100_000, 1),
        ))

    results.sort(key=lambda r: -r.heat)
    return results[:RESULT_SIZE]


def with_membership(topics: list[dict], db: Session) -> list[dict]:
    """替每個主題標上「是否已在興趣清單裡」。

    每次讀取都重算，不隨結果一起快取：主題快取一次可以放上一整週，而興趣清單
    隨時會變。存進去的話，加入之後按鈕仍顯示「+」，再按一次拿到 409，
    看起來就像加不進去——實際發生過。

    舊快取裡若殘留這個欄位，這裡會覆蓋掉它。
    """
    existing = {row.term.lower() for row in db.query(Interest).all()}
    return [{**t, "already_added": str(t.get("topic", "")).lower() in existing} for t in topics]


def load_cached(db: Session) -> tuple[list[dict], str | None]:
    """讀出上次計算結果與時間。前端先顯示這個，不讓使用者等。"""
    raw = get_setting(AppSettingKey.TRENDING_TOPICS_CACHE, db)
    if not raw:
        return [], None
    try:
        payload = json.loads(raw)
        return payload.get("topics", []), payload.get("computed_at")
    except Exception as e:
        logger.warning(f"[熱門主題] 快取無法解析: {e}")
        return [], None


def save_cache(db: Session, topics: list[TrendingTopic]) -> str:
    # 必須帶 Z：utc_now() 回傳 naive datetime（為了 SQLite 比較一致），
    # 直接 isoformat() 會產生沒有時區標記的字串，前端 new Date() 會把它
    # 當成「本地時間」——實測在 UTC+8 顯示成「8 小時前」，但其實是剛剛。
    computed_at = utc_now().isoformat() + "Z"
    set_setting(
        AppSettingKey.TRENDING_TOPICS_CACHE,
        json.dumps({"computed_at": computed_at, "topics": [asdict(t) for t in topics]}),
        db,
    )
    return computed_at


def save_progress(db: Session, phase: str, done: int, total: int) -> None:
    """寫入進度。刻意用獨立的設定鍵：輪詢進度不該去解析整份結果 JSON。"""
    set_setting(
        AppSettingKey.TRENDING_PROGRESS,
        json.dumps({"phase": phase, "done": done, "total": total}),
        db,
    )


def clear_progress(db: Session) -> None:
    set_setting(AppSettingKey.TRENDING_PROGRESS, "", db)


def load_progress(db: Session) -> dict | None:
    """回傳進行中的進度；沒有在跑時回 None。"""
    raw = get_setting(AppSettingKey.TRENDING_PROGRESS, db)
    if not raw:
        return None
    try:
        payload: dict = json.loads(raw)
        return payload
    except Exception:
        return None
