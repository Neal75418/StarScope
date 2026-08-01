"""
For You feed 評分器 — 純函數，無 I/O。

score = interest_match × freshness × momentum_lite
權重與衰減參數定義見 docs/superpowers/specs/2026-08-01-for-you-feed-design.md。
"""
import math
from dataclasses import dataclass
from datetime import datetime

from db.models import Interest, InterestKind

KIND_MULTIPLIER: dict[str, float] = {
    InterestKind.TOPIC: 1.0,
    InterestKind.LANGUAGE: 0.6,
    InterestKind.KEYWORD: 0.4,
}
FRESH_FULL_DAYS = 30.0   # 此天數內 pushed 視為滿分
FRESH_ZERO_DAYS = 180.0  # 此天數以上歸零


@dataclass(frozen=True)
class ScoreBreakdown:
    score: float
    interest_score: float
    freshness: float
    momentum: float
    matched_terms: list[str]


def compute_interest_match(
    topics: list[str],
    language: str | None,
    name: str,
    description: str | None,
    interests: list[Interest],
) -> tuple[float, list[str]]:
    topics_lower = {t.lower() for t in topics}
    name_lower = name.lower()
    desc_lower = (description or "").lower()
    lang_lower = (language or "").lower()

    total = 0.0
    matched: list[str] = []
    for interest in interests:
        term = interest.term.lower()
        kind = interest.kind
        hit = (
            (kind == InterestKind.TOPIC and term in topics_lower)
            or (kind == InterestKind.LANGUAGE and lang_lower == term)
            or (kind == InterestKind.KEYWORD and (term in name_lower or term in desc_lower))
        )
        if hit:
            total += interest.weight * KIND_MULTIPLIER[kind]
            matched.append(f"{kind}:{interest.term}")
    return total, matched


def compute_freshness(pushed_at: datetime | None, now: datetime) -> float:
    if pushed_at is None:
        return 0.0
    days = max(0.0, (now - pushed_at).total_seconds() / 86400)
    if days <= FRESH_FULL_DAYS:
        return 1.0
    if days >= FRESH_ZERO_DAYS:
        return 0.0
    return 1.0 - (days - FRESH_FULL_DAYS) / (FRESH_ZERO_DAYS - FRESH_FULL_DAYS)


def compute_momentum_lite(stars: int, created_at: datetime | None, now: datetime) -> float:
    if created_at is None:
        return 0.0
    age_days = max(1.0, (now - created_at).total_seconds() / 86400)
    return math.log1p(max(0, stars) / age_days)


def score_candidate(
    topics: list[str],
    language: str | None,
    name: str,
    description: str | None,
    stars: int,
    created_at: datetime | None,
    pushed_at: datetime | None,
    interests: list[Interest],
    now: datetime,
) -> ScoreBreakdown:
    interest_score, matched = compute_interest_match(topics, language, name, description, interests)
    freshness = compute_freshness(pushed_at, now)
    momentum = compute_momentum_lite(stars, created_at, now)
    return ScoreBreakdown(
        score=interest_score * freshness * momentum,
        interest_score=interest_score,
        freshness=freshness,
        momentum=momentum,
        matched_terms=matched,
    )
