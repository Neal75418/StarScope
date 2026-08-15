"""
For You feed 產生管線。

每日流程：讀興趣 → 每個興趣打一次 GitHub search →
去重/黑名單/seen/watchlist 過濾 → 評分排序 → 多樣性上限 → 寫 feed_items + seen_repos。
"""
import json
import re
import logging
import math
from datetime import date, datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from db.soft_delete import include_archived
from db.models import (
    Interest, InterestKind, ExcludeTerm, FeedCandidate, FeedItem, SeenRepo, Repo,
)
from services.feed_defaults import ensure_default_exclude_terms
from services.github import GitHubRateLimitError
from services.feed_scoring import score_candidate
from utils.time import utc_now

logger = logging.getLogger(__name__)

FEED_SIZE = 20
MAX_PER_TERM = math.ceil(FEED_SIZE / 3)  # 同一 term 來源的多樣性上限（=7）
CANDIDATE_WINDOW_DAYS = 60   # 只搜此天數內建立的 repo
MIN_STARS = 20               # 過濾雜訊下限
PER_QUERY_RESULTS = 30


def collect_watchlist_keys(db: Session) -> tuple[set[int], set[str]]:
    """建立 feed 候選的排除集。

    必須含封存的 repo：使用者刻意取消 star 的東西不該重新被推薦，而 SeenRepo
    擋不住當初從 star 匯入、未經 feed 的那些——它們沒有 SeenRepo 記錄。
    """
    rows = include_archived(db.query(Repo)).all()
    return ({r.github_id for r in rows if r.github_id},
            {r.full_name.lower() for r in rows})


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")


def _normalize_words(text: str) -> str:
    """把分隔符（含底線）換成單一空白，讓黑名單詞與比對目標用同一套切分規則。"""
    return re.sub(r"[\W_]+", " ", text, flags=re.UNICODE).strip()


def normalize_exclude_term(term: str) -> str:
    """把黑名單詞正規化成比對用的形式（小寫、分隔符收斂為空白）。"""
    return _normalize_words(term.lower())


def is_usable_exclude_term(term: str) -> bool:
    """這個黑名單詞正規化後是否還有比對能力。

    「至少 2 字元」的門檻是入口驗證（routers/interests.py）與比對層
    （compile_exclusions）共用的單一來源——分成兩份各自維護時，改一邊會讓
    另一邊靜默失準：入口放行、比對層卻默默忽略。
    """
    return len(normalize_exclude_term(term)) >= 2


def compile_exclusions(exclude: set[str]) -> list[re.Pattern[str]]:
    """把黑名單詞預先編成 regex（每輪 feed 只做一次，不要在每個候選上重編）。

    規約（每條都對應一個踩過的 bug，改動前先看 test_exclude_matching_rules）：

    - 前後都要是詞界：`ai` 既不吃 tailwind**css** 也不吃 **ai**rbnb，
      只有整個詞是 ai 才擋。裸子字串與「前綴比對」都試過，兩者都會誤殺
    - 允許複數字尾，且**只涵蓋 s / es / y→ies**：否則 `interview` 擋不掉
      coding-interviews、`library` 擋不掉 python-libraries。代價是不含分隔符的
      複合字（awesomelist、tutorialspoint）擋不到——那是不做前綴比對的必然取捨
    - 兩側用同一套正規化：否則 `machine-learning`、`node.js` 這種含分隔符的詞
      永遠對不上，變成靜默 no-op
    - 正規化後**短於 2 字元的詞一律丟棄**：`c++`、`c#` 都會塌成 `c`，留著會擋掉
      awesome-c、c-sharp 這類無關專案。純標點的詞（`++`）同樣被丟棄
    """
    patterns = []
    for term in exclude:
        norm = normalize_exclude_term(term)
        if not is_usable_exclude_term(term):
            logger.warning(f"[Feed] 黑名單詞 {term!r} 正規化後過短（{norm!r}），已忽略")
            continue
        # y → ies（library/libraries）需要單獨處理，不能只靠 (?:e?s)?
        stem = (rf"{re.escape(norm[:-1])}(?:y|ys|ies)" if norm.endswith("y")
                else rf"{re.escape(norm)}(?:e?s)?")
        patterns.append(re.compile(rf"(?<!\w){stem}(?!\w)"))
    return patterns


def _is_excluded(item: dict, patterns: list[re.Pattern[str]]) -> bool:
    haystacks = [item["full_name"].lower(), *[t.lower() for t in item.get("topics", [])]]
    # 正規化放外層：放進 any() 的內層子句會變成每個 pattern 都重算一次
    return any(p.search(norm) for norm in map(_normalize_words, haystacks) for p in patterns)


async def _fetch_candidates(github, interests: list[Interest],
                            created_after: str) -> tuple[dict[int, dict], bool]:
    """每個興趣打一次 search，以 github_id 去重合併。

    Returns:
        ``(merged, quota_tripped)``。``quota_tripped`` 為 True 表示 fan-out 是被
        GitHub 配額中止的——呼叫端必須據此決定要不要讓錯誤浮出去，否則
        「配額用盡」會在前端顯示成「請去新增興趣」。
    """
    merged: dict[int, dict] = {}
    for interest in interests:
        base_q = f"created:>{created_after}"
        kwargs: dict = {
            "query": base_q, "min_stars": MIN_STARS,
            "sort": "stars", "order": "desc",
            "page": 1, "per_page": PER_QUERY_RESULTS, "hide_archived": True,
        }
        if interest.kind == InterestKind.TOPIC:
            kwargs["topic"] = interest.term
        elif interest.kind == InterestKind.LANGUAGE:
            kwargs["language"] = interest.term
        else:  # keyword
            kwargs["query"] = f"{interest.term} {base_q}"
        try:
            result = await github.search_repos(**kwargs)
        except GitHubRateLimitError:
            # 配額耗盡時繼續打剩下的興趣只會更快燒光配額，所以中止 fan-out；
            # 但**保留已經取得的候選**而非整輪丟棄——寫得出幾筆，當日的 existing>0
            # 短路才會成立，否則前端每次重新掛載又會從第一個興趣重跑一整輪。
            logger.warning(
                f"[Feed] GitHub 配額耗盡，於興趣 {interest.term!r} 中止；"
                f"保留已取得的 {len(merged)} 個候選")
            return merged, True
        except Exception as e:  # 單一查詢失敗不拖垮整批
            logger.warning(f"[Feed] 興趣 {interest.term} 搜尋失敗: {e}")
            continue
        for item in result.get("items", []):
            merged.setdefault(item["id"], item)
    return merged, False


def _upsert_candidate(db: Session, item: dict) -> FeedCandidate:
    cand = db.query(FeedCandidate).filter(
        FeedCandidate.github_id == item["id"]).first()
    if cand is None:
        cand = FeedCandidate(github_id=item["id"])
        db.add(cand)
    cand.full_name = item["full_name"]
    cand.owner = item["owner"]["login"]
    cand.name = item["name"]
    cand.description = (item.get("description") or "")[:2048] or None
    cand.language = item.get("language")
    cand.topics = json.dumps(item.get("topics", []))
    cand.stars = item.get("stargazers_count", 0)
    cand.forks = item.get("forks_count", 0)
    cand.url = item["html_url"]
    cand.owner_avatar_url = item["owner"].get("avatar_url")
    cand.repo_created_at = _parse_dt(item.get("created_at"))
    cand.repo_pushed_at = _parse_dt(item.get("pushed_at"))
    return cand


async def generate_feed(db: Session, github, feed_date: date,
                        now: datetime | None = None) -> int:
    """產生指定日期的 feed。當日已存在則回傳既有數量（不重打 API）。"""
    existing = db.query(FeedItem).filter(FeedItem.feed_date == feed_date).count()
    if existing > 0:
        return existing

    now = now or utc_now()
    interests = db.query(Interest).all()
    if not interests:
        return 0

    ensure_default_exclude_terms(db)
    exclude_patterns = compile_exclusions({e.term.lower() for e in db.query(ExcludeTerm).all()})
    seen_ids = {s.github_id for s in db.query(SeenRepo).all()}
    watchlist_ids, watchlist_names = collect_watchlist_keys(db)

    created_after = (now - timedelta(days=CANDIDATE_WINDOW_DAYS)).date().isoformat()
    merged, quota_tripped = await _fetch_candidates(github, interests, created_after)

    scored: list[tuple[float, dict, list[str]]] = []
    for item in merged.values():
        if item["id"] in seen_ids or item["id"] in watchlist_ids:
            continue
        if item["full_name"].lower() in watchlist_names:
            continue
        if _is_excluded(item, exclude_patterns):
            continue
        breakdown = score_candidate(
            topics=item.get("topics", []),
            language=item.get("language"),
            name=item["name"],
            description=item.get("description"),
            stars=item.get("stargazers_count", 0),
            created_at=_parse_dt(item.get("created_at")),
            pushed_at=_parse_dt(item.get("pushed_at")),
            interests=interests,
            now=now,
        )
        if breakdown.score <= 0:
            continue
        scored.append((breakdown.score, item, breakdown.matched_terms))

    scored.sort(key=lambda t: t[0], reverse=True)

    # 多樣性上限：以首個命中 term 為該項目的來源分組
    per_term_count: dict[str, int] = {}
    written = 0
    # try 必須涵蓋「整個寫入迴圈」而不只是 db.commit()：迴圈內的 db.flush()
    # 會把上一輪 pending 的 FeedItem/SeenRepo INSERT 送進 DB，競態下的
    # IntegrityError 多數是在那裡爆的，只包 commit 等於只保護到最後一筆。
    try:
        for score, item, matched in scored:
            if written >= FEED_SIZE:
                break
            primary = matched[0] if matched else "unknown"
            if per_term_count.get(primary, 0) >= MAX_PER_TERM:
                continue
            cand = _upsert_candidate(db, item)
            db.flush()  # 取得 cand.id
            age_days = None
            if cand.repo_created_at:
                age_days = int((now - cand.repo_created_at).total_seconds() // 86400)
            reason = {
                "matched": matched,
                "stars": cand.stars,
                "age_days": age_days,
                "pushed_at": item.get("pushed_at"),
            }
            db.add(FeedItem(candidate_id=cand.id, feed_date=feed_date,
                            score=score, reason_json=json.dumps(reason)))
            db.add(SeenRepo(github_id=cand.github_id, full_name=cand.full_name,
                            last_shown_at=now))
            per_term_count[primary] = per_term_count.get(primary, 0) + 1
            written += 1

        db.commit()
    except IntegrityError:
        # cron 與 API on-demand 同時觸發時，count==0 檢查與寫入之間的 await
        # 讓兩個 writer 都通過了「當日無 feed」的檢查；先 commit 的一方會成功，
        # 後 commit 的一方在此撞 uq_feed_items_candidate_date 或
        # seen_repos.github_id unique constraint。視為「別人已產生」，
        # rollback 後回傳既有數量，不讓使用者看到 500。
        db.rollback()
        existing_after_race = db.query(FeedItem).filter(
            FeedItem.feed_date == feed_date).count()
        logger.warning(
            f"[Feed] {feed_date} 併發寫入衝突，已由其他 writer 產生 "
            f"{existing_after_race} 條，捨棄本次結果"
        )
        return existing_after_race

    if quota_tripped and written == 0:
        # 一筆都沒寫入時必須讓錯誤浮出去：回 200 {generated: 0} 會讓前端
        # 顯示「請至設定新增興趣」——使用者明明設了興趣，真因是配額用盡。
        # 有寫入時則不拋（保留部分結果，當日 existing>0 短路才會成立）。
        raise GitHubRateLimitError(
            "GitHub API rate limit exceeded during feed generation")

    if quota_tripped:
        logger.warning(
            f"[Feed] {feed_date} 因配額中止，僅產生 {written} 條（部分結果已保留）")
    logger.info(f"[Feed] {feed_date} 產生 {written} 條（候選 {len(merged)}）")
    return written
