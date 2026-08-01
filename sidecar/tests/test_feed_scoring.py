"""Feed 評分器單元測試 — 純函數，窮舉邊界。"""
import math
from datetime import datetime, timedelta

from db.models import Interest, InterestKind
from services.feed_scoring import (
    compute_interest_match, compute_freshness, compute_momentum_lite, score_candidate,
)

NOW = datetime(2026, 8, 1, 12, 0, 0)


def _interest(term, kind, weight=2):
    return Interest(term=term, kind=kind, weight=weight)


# --- interest_match：三種 kind × 命中/未命中 ---

def test_topic_match_full_weight():
    score, matched = compute_interest_match(
        ["tauri", "rust"], None, "x", None, [_interest("tauri", InterestKind.TOPIC, 3)])
    assert score == 3 * 1.0
    assert matched == ["topic:tauri"]


def test_topic_match_case_insensitive():
    score, _ = compute_interest_match(
        ["Tauri"], None, "x", None, [_interest("tauri", InterestKind.TOPIC, 1)])
    assert score == 1.0


def test_language_match_weight_06():
    score, matched = compute_interest_match(
        [], "Rust", "x", None, [_interest("rust", InterestKind.LANGUAGE, 2)])
    assert score == 2 * 0.6
    assert matched == ["language:rust"]


def test_keyword_match_in_name_weight_04():
    score, _ = compute_interest_match(
        [], None, "my-quant-tool", None, [_interest("quant", InterestKind.KEYWORD, 2)])
    assert score == 2 * 0.4


def test_keyword_match_in_description():
    score, _ = compute_interest_match(
        [], None, "x", "a quant backtester", [_interest("quant", InterestKind.KEYWORD, 1)])
    assert score == 0.4


def test_keyword_no_description_no_crash():
    score, matched = compute_interest_match(
        [], None, "x", None, [_interest("quant", InterestKind.KEYWORD, 1)])
    assert score == 0.0 and matched == []


def test_multiple_hits_sum():
    interests = [
        _interest("tauri", InterestKind.TOPIC, 3),
        _interest("rust", InterestKind.LANGUAGE, 2),
    ]
    score, matched = compute_interest_match(["tauri"], "Rust", "x", None, interests)
    assert score == 3 * 1.0 + 2 * 0.6
    assert matched == ["topic:tauri", "language:rust"]


def test_no_interests_zero():
    assert compute_interest_match(["tauri"], "Rust", "x", None, []) == (0.0, [])


# --- freshness：30 天全額 → 180 天歸零，端點窮舉 ---

def test_freshness_none_pushed_at_is_zero():
    assert compute_freshness(None, NOW) == 0.0


def test_freshness_today():
    assert compute_freshness(NOW, NOW) == 1.0


def test_freshness_at_exactly_30_days():
    assert compute_freshness(NOW - timedelta(days=30), NOW) == 1.0


def test_freshness_at_105_days_is_half():
    # 30→180 線性：105 天位於中點
    assert abs(compute_freshness(NOW - timedelta(days=105), NOW) - 0.5) < 1e-9


def test_freshness_at_180_days_is_zero():
    assert compute_freshness(NOW - timedelta(days=180), NOW) == 0.0


def test_freshness_beyond_180_days_clamped_zero():
    assert compute_freshness(NOW - timedelta(days=400), NOW) == 0.0


# --- momentum：log1p(stars/age)，邊界窮舉 ---

def test_momentum_created_today_age_floor_one_day():
    # age 下限 1 天，避免除以零
    assert compute_momentum_lite(100, NOW, NOW) == math.log1p(100.0)


def test_momentum_zero_stars():
    assert compute_momentum_lite(0, NOW - timedelta(days=10), NOW) == 0.0


def test_momentum_none_created_at_is_zero():
    assert compute_momentum_lite(500, None, NOW) == 0.0


def test_momentum_typical():
    got = compute_momentum_lite(380, NOW - timedelta(days=45), NOW)
    assert abs(got - math.log1p(380 / 45)) < 1e-9


# --- score_candidate：乘法組合 ---

def test_score_is_product_of_three_factors():
    b = score_candidate(
        topics=["tauri"], language="Rust", name="x", description=None,
        stars=380, created_at=NOW - timedelta(days=45),
        pushed_at=NOW - timedelta(days=5),
        interests=[_interest("tauri", InterestKind.TOPIC, 2)], now=NOW)
    assert abs(b.score - b.interest_score * b.freshness * b.momentum) < 1e-9
    assert b.matched_terms == ["topic:tauri"]


def test_score_zero_when_no_interest_match():
    b = score_candidate(
        topics=[], language=None, name="x", description=None,
        stars=1000, created_at=NOW - timedelta(days=10),
        pushed_at=NOW, interests=[_interest("tauri", InterestKind.TOPIC, 3)], now=NOW)
    assert b.score == 0.0
