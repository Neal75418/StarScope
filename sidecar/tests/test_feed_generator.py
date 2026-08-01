"""Feed 產生管線整合測試 — fake GitHubService，不打真 API。"""
from datetime import date, datetime, timedelta

import pytest

from db.models import (
    Interest, InterestKind, ExcludeTerm, FeedItem, SeenRepo, Repo, FeedCandidate,
)
from services.feed_generator import generate_feed, FEED_SIZE, MAX_PER_TERM

NOW = datetime(2026, 8, 1, 12, 0, 0)
TODAY = date(2026, 8, 1)


def _gh_item(gid: int, full_name: str, *, topics=None, language="Rust",
             stars=200, days_old=30, days_since_push=3):
    owner, name = full_name.split("/")
    return {
        "id": gid, "full_name": full_name, "name": name,
        "owner": {"login": owner, "avatar_url": f"https://a/{owner}"},
        "description": f"desc of {name}", "language": language,
        "topics": topics or [], "stargazers_count": stars, "forks_count": 5,
        "html_url": f"https://github.com/{full_name}",
        "created_at": (NOW - timedelta(days=days_old)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "pushed_at": (NOW - timedelta(days=days_since_push)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "updated_at": NOW.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "open_issues_count": 0, "license": None,
    }


class FakeGitHub:
    def __init__(self, items_by_term: dict[str, list[dict]]):
        self.items_by_term = items_by_term
        self.calls: list[dict] = []

    async def search_repos(self, **kwargs):
        self.calls.append(kwargs)
        term = kwargs.get("topic") or kwargs.get("language") or kwargs.get("query", "").split()[0]
        return {"items": self.items_by_term.get(term, []), "total_count": 0}


@pytest.mark.asyncio
async def test_no_interests_returns_zero(test_db):
    count = await generate_feed(test_db, FakeGitHub({}), TODAY, now=NOW)
    assert count == 0


@pytest.mark.asyncio
async def test_generates_scored_items_with_reason(test_db):
    test_db.add(Interest(term="tauri", kind=InterestKind.TOPIC, weight=3))
    test_db.commit()
    gh = FakeGitHub({"tauri": [_gh_item(1, "a/one", topics=["tauri"])]})
    count = await generate_feed(test_db, gh, TODAY, now=NOW)
    assert count == 1
    item = test_db.query(FeedItem).one()
    assert item.score > 0
    assert "topic:tauri" in item.reason_json
    assert test_db.query(SeenRepo).count() == 1  # 進 feed 即記入 seen


@pytest.mark.asyncio
async def test_seen_repo_not_recommended_again(test_db):
    test_db.add(Interest(term="tauri", kind=InterestKind.TOPIC, weight=3))
    test_db.add(SeenRepo(github_id=1, full_name="a/one"))
    test_db.commit()
    gh = FakeGitHub({"tauri": [_gh_item(1, "a/one", topics=["tauri"])]})
    assert await generate_feed(test_db, gh, TODAY, now=NOW) == 0


@pytest.mark.asyncio
async def test_excluded_term_filtered(test_db):
    test_db.add(Interest(term="tauri", kind=InterestKind.TOPIC, weight=3))
    test_db.add(ExcludeTerm(term="awesome"))
    test_db.commit()
    gh = FakeGitHub({"tauri": [
        _gh_item(1, "a/awesome-tauri", topics=["tauri"]),           # 名稱命中黑名單
        _gh_item(2, "a/ok", topics=["tauri", "awesome-list"]),      # topic 命中黑名單
        _gh_item(3, "a/fine", topics=["tauri"]),
    ]})
    assert await generate_feed(test_db, gh, TODAY, now=NOW) == 1
    assert test_db.query(FeedItem).one().candidate.full_name == "a/fine"


@pytest.mark.asyncio
async def test_watchlist_repo_excluded(test_db):
    test_db.add(Interest(term="tauri", kind=InterestKind.TOPIC, weight=3))
    test_db.add(Repo(owner="a", name="one", full_name="a/one",
                     url="https://github.com/a/one", github_id=1))
    test_db.commit()
    gh = FakeGitHub({"tauri": [_gh_item(1, "a/one", topics=["tauri"])]})
    assert await generate_feed(test_db, gh, TODAY, now=NOW) == 0


@pytest.mark.asyncio
async def test_single_term_capped_at_max_per_term(test_db):
    # 只有一個興趣時，多樣性上限就是 feed 上限
    test_db.add(Interest(term="rust", kind=InterestKind.LANGUAGE, weight=3))
    test_db.commit()
    items = [_gh_item(i, f"a/r{i}", language="Rust", stars=100 + i) for i in range(40)]
    gh = FakeGitHub({"rust": items})
    assert await generate_feed(test_db, gh, TODAY, now=NOW) == MAX_PER_TERM


@pytest.mark.asyncio
async def test_feed_size_cap_with_multiple_terms(test_db):
    # 三個興趣各給 40 個候選 → 各自被 MAX_PER_TERM 截斷後仍超過 FEED_SIZE → 總數 = FEED_SIZE
    for lang in ("rust", "go", "python"):
        test_db.add(Interest(term=lang, kind=InterestKind.LANGUAGE, weight=2))
    test_db.commit()
    gh = FakeGitHub({
        lang: [_gh_item(base + i, f"{lang}/r{i}", language=lang.capitalize(),
                        stars=100 + i) for i in range(40)]
        for base, lang in ((0, "rust"), (100, "go"), (200, "python"))
    })
    assert await generate_feed(test_db, gh, TODAY, now=NOW) == FEED_SIZE


@pytest.mark.asyncio
async def test_diversity_cap_per_term(test_db):
    # tauri 來源給 20 個、rust 來源給 20 個 → tauri 最多 MAX_PER_TERM 條
    test_db.add(Interest(term="tauri", kind=InterestKind.TOPIC, weight=3))
    test_db.add(Interest(term="rust", kind=InterestKind.LANGUAGE, weight=1))
    test_db.commit()
    gh = FakeGitHub({
        "tauri": [_gh_item(i, f"t/r{i}", topics=["tauri"], language=None, stars=500)
                  for i in range(20)],
        "rust": [_gh_item(100 + i, f"r/r{i}", language="Rust", stars=50)
                 for i in range(20)],
    })
    await generate_feed(test_db, gh, TODAY, now=NOW)
    items = test_db.query(FeedItem).all()
    tauri_count = sum(1 for it in items if "topic:tauri" in it.reason_json)
    assert tauri_count == MAX_PER_TERM


@pytest.mark.asyncio
async def test_idempotent_same_day(test_db):
    test_db.add(Interest(term="tauri", kind=InterestKind.TOPIC, weight=3))
    test_db.commit()
    gh = FakeGitHub({"tauri": [_gh_item(1, "a/one", topics=["tauri"])]})
    assert await generate_feed(test_db, gh, TODAY, now=NOW) == 1
    assert await generate_feed(test_db, gh, TODAY, now=NOW) == 1  # 回既有數量
    assert len(gh.calls) == 1  # 第二次不再打 API


@pytest.mark.asyncio
async def test_zero_score_items_dropped(test_db):
    # 只命中興趣但 momentum=0（zero stars）→ score 0 → 不進 feed
    test_db.add(Interest(term="tauri", kind=InterestKind.TOPIC, weight=3))
    test_db.commit()
    gh = FakeGitHub({"tauri": [_gh_item(1, "a/dead", topics=["tauri"], stars=0)]})
    assert await generate_feed(test_db, gh, TODAY, now=NOW) == 0
