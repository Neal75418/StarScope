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

from db.models import (
    Interest, InterestKind, ExcludeTerm, FeedCandidate, FeedItem, SeenRepo, Repo,
)
from services.feed_defaults import ensure_default_exclude_terms
from services.feed_scoring import score_candidate
from utils.time import utc_now

logger = logging.getLogger(__name__)

FEED_SIZE = 20
MAX_PER_TERM = math.ceil(FEED_SIZE / 3)  # 同一 term 來源的多樣性上限（=7）
CANDIDATE_WINDOW_DAYS = 60   # 只搜此天數內建立的 repo
MIN_STARS = 20               # 過濾雜訊下限
PER_QUERY_RESULTS = 30


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")


def _is_excluded(item: dict, exclude: set[str]) -> bool:
    """黑名單比對。

    以詞界（非英數字元）切分後比對整個詞，不做裸子字串比對——否則加入 "ai"
    這種短詞會連帶殺掉 tailwindcss、langchain、任何含 mail/chain/main 的專案。
    """
    haystacks = [item["full_name"].lower(), *[t.lower() for t in item.get("topics", [])]]
    words = {w for hay in haystacks for w in re.split(r"[^a-z0-9]+", hay) if w}
    return bool(words & exclude)


async def _fetch_candidates(github, interests: list[Interest],
                            created_after: str) -> dict[int, dict]:
    """每個興趣打一次 search，以 github_id 去重合併。"""
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
        except Exception as e:  # 單一查詢失敗不拖垮整批
            logger.warning(f"[feed] 興趣 {interest.term} 搜尋失敗: {e}")
            continue
        for item in result.get("items", []):
            merged.setdefault(item["id"], item)
    return merged


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
    exclude = {e.term.lower() for e in db.query(ExcludeTerm).all()}
    seen_ids = {s.github_id for s in db.query(SeenRepo).all()}
    watchlist_ids = {r.github_id for r in db.query(Repo).all() if r.github_id}
    watchlist_names = {r.full_name.lower() for r in db.query(Repo).all()}

    created_after = (now - timedelta(days=CANDIDATE_WINDOW_DAYS)).date().isoformat()
    merged = await _fetch_candidates(github, interests, created_after)

    scored: list[tuple[float, dict, list[str]]] = []
    for item in merged.values():
        if item["id"] in seen_ids or item["id"] in watchlist_ids:
            continue
        if item["full_name"].lower() in watchlist_names:
            continue
        if _is_excluded(item, exclude):
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

    try:
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
            f"[feed] {feed_date} 併發寫入衝突，已由其他 writer 產生 "
            f"{existing_after_race} 條，捨棄本次結果"
        )
        return existing_after_race

    logger.info(f"[feed] {feed_date} 產生 {written} 條（候選 {len(merged)}）")
    return written
