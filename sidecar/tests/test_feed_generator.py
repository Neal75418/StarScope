"""Feed 產生管線整合測試 — fake GitHubService，不打真 API。"""
import json
import os
import tempfile
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from db.models import (
    Base, Interest, InterestKind, ExcludeTerm, FeedItem, SeenRepo, Repo, FeedCandidate,
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


@pytest.mark.asyncio
async def test_keyword_interest_generates_item_with_reason(test_db):
    # KEYWORD kind 走 query 拼接分支（非 topic/language 參數），需獨立回歸保護
    test_db.add(Interest(term="quant", kind=InterestKind.KEYWORD, weight=2))
    test_db.commit()
    gh = FakeGitHub({"quant": [_gh_item(1, "a/quant-lib", topics=[])]})
    count = await generate_feed(test_db, gh, TODAY, now=NOW)
    assert count == 1
    item = test_db.query(FeedItem).one()
    assert "keyword:quant" in item.reason_json
    assert gh.calls[0]["query"].startswith("quant ")


@pytest.mark.asyncio
async def test_concurrent_generate_returns_existing_count_instead_of_500():
    """count==0 檢查與最終 db.commit() 之間隔著多個 await（GitHub search、
    scoring）。當 cron 排程與 API on-demand 同時進入 generate_feed，兩者都
    通過 count==0 檢查後，先 commit 的一方成功、後 commit 的一方會在自己的
    db.commit() 撞上 uq_feed_items_candidate_date / seen_repos.github_id
    unique constraint。預期行為：捕捉 IntegrityError、rollback，回傳「別人
    已產生」的既有數量，而不是讓 IntegrityError 冒到 API 層變成 500。

    用檔案型 SQLite（而非 :memory: + StaticPool）搭配兩個獨立 session，
    讓「另一個 writer」的 commit 是真實獨立的交易，藉此重現真正的競態，
    而不是單純 mock 掉 db.commit()。
    """
    fd, db_path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    try:
        engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
        Base.metadata.create_all(bind=engine)
        session_local = sessionmaker(
            autocommit=False, autoflush=False, expire_on_commit=False, bind=engine)

        db = session_local()
        db.add(Interest(term="tauri", kind=InterestKind.TOPIC, weight=3))
        db.commit()

        race_state = {"other_writer_committed": False}

        class RaceGitHub:
            """在第一次 search_repos 的 await 期間，模擬另一個 writer
            搶先為同一天、同一 candidate 寫入 feed_item + seen_repo 並真的
            commit — 對應真實情境中 cron job 與 API 同時進入的窗口。"""

            def __init__(self, items_by_term: dict[str, list[dict]]):
                self.items_by_term = items_by_term

            async def search_repos(self, **kwargs):
                if not race_state["other_writer_committed"]:
                    other = session_local()
                    try:
                        cand = FeedCandidate(
                            github_id=1, full_name="a/one", owner="a", name="one",
                            url="https://github.com/a/one", stars=200, forks=5,
                            topics=json.dumps(["tauri"]))
                        other.add(cand)
                        other.flush()
                        other.add(FeedItem(candidate_id=cand.id, feed_date=TODAY,
                                           score=1.0, reason_json="{}"))
                        other.add(SeenRepo(github_id=1, full_name="a/one"))
                        other.commit()
                    finally:
                        other.close()
                    race_state["other_writer_committed"] = True

                term = kwargs.get("topic") or kwargs.get("language") or kwargs.get("query", "").split()[0]
                return {"items": self.items_by_term.get(term, []), "total_count": 0}

        gh = RaceGitHub({"tauri": [_gh_item(1, "a/one", topics=["tauri"])]})

        count = await generate_feed(db, gh, TODAY, now=NOW)

        # 回傳的是另一個 writer 已經 commit 的既有數量，不是拋出例外
        assert count == 1
        assert db.query(FeedItem).count() == 1
        assert db.query(FeedCandidate).count() == 1
        db.close()
    finally:
        os.remove(db_path)


def test_exclude_matching_rules():
    """黑名單比對規約。每個 assert 都對應一個實際踩過的 bug，改動實作前先讓這些通過。"""
    from services.feed_generator import _is_excluded, compile_exclusions

    def check(terms, full_name="x/y", topics=None):
        return _is_excluded({"full_name": full_name, "topics": topics or []},
                            compile_exclusions(set(terms)))

    # ① 詞中間出現不算：ai 不該吃掉 tailwindcss（t-ai-lwindlabs）
    assert check(["ai"], "tailwindlabs/tailwindcss", ["css"]) is False
    # ② 詞開頭出現也不算：ai 不該吃掉 airbnb、go 不該吃掉 google
    assert check(["ai"], "airbnb/javascript") is False
    assert check(["go"], "google/guava") is False
    # ③ 整個詞出現才算
    assert check(["ai"], "someone/ai") is True
    # ④ 允許複數字尾：黑名單最該擋的就是這些清單型 repo
    assert check(["interview"], topics=["coding-interviews"]) is True
    assert check(["tutorial"], topics=["python-tutorials"]) is True
    assert check(["roadmap"], "dev/awesome-roadmaps") is True
    # ⑤ 底線也是分隔符
    assert check(["awesome"], "user/my_awesome_list") is True
    # ⑥ 含分隔符的詞組要能匹配（兩側同一套正規化）
    assert check(["machine-learning"], topics=["machine-learning"]) is True
    assert check(["node.js"], "a/node.js-starter") is True
    # ⑦ 正規化後短於 2 字元的詞一律丟棄：c++ / c# 都塌成 c，留著會擋掉無關專案
    assert check(["c++"], "cli-tool/chrome") is False
    assert check(["c++"], "foo/awesome-c") is False      # 「c」是獨立詞也不該中
    assert check(["c#"], "foo/c-sharp") is False
    assert check(["++"], "foo/anything") is False        # 純標點正規化為空
    # ⑧ y → ies 也算複數（只靠 (?:e?s)? 涵蓋不到）
    assert check(["library"], topics=["python-libraries"]) is True
    assert check(["library"], topics=["a-library"]) is True
    # ⑨ 已知取捨：不含分隔符的複合字擋不到（不做前綴比對的必然代價）
    assert check(["awesome"], "user/awesomelist") is False


@pytest.mark.asyncio
async def test_rate_limit_aborts_instead_of_draining_quota(test_db):
    """配額耗盡時中止整輪並往上拋，不繼續打剩下的興趣。

    繼續打只會更快燒光配額，而且會寫入 0 筆——當日 existing>0 短路永遠不成立，
    前端每次重新掛載又觸發整輪 fan-out，形成自我延續的耗盡迴圈。
    """
    from services.github import GitHubRateLimitError

    for term in ("rust", "tauri", "flutter"):
        test_db.add(Interest(term=term, kind=InterestKind.TOPIC, weight=2))
    test_db.commit()

    calls = []

    class RateLimitedGitHub:
        async def search_repos(self, **kwargs):
            calls.append(kwargs)
            raise GitHubRateLimitError("quota exhausted")

    with pytest.raises(GitHubRateLimitError):
        await generate_feed(test_db, RateLimitedGitHub(), TODAY)

    assert len(calls) == 1, "撞到配額後不應繼續打其餘興趣"
    assert test_db.query(FeedItem).count() == 0
