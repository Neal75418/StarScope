"""Feed 相關資料表的模型測試。"""
from datetime import date

from db.models import (
    Interest, InterestKind, ExcludeTerm, FeedCandidate, FeedItem, SeenRepo,
)


def test_interest_crud(test_db):
    test_db.add(Interest(term="tauri", kind=InterestKind.TOPIC, weight=3))
    test_db.commit()
    row = test_db.query(Interest).one()
    assert (row.term, row.kind, row.weight) == ("tauri", "topic", 3)
    assert row.created_at is not None


def test_interest_defaults(test_db):
    test_db.add(Interest(term="rust"))
    test_db.commit()
    row = test_db.query(Interest).one()
    assert row.kind == InterestKind.TOPIC
    assert row.weight == 2


def test_feed_item_links_candidate(test_db):
    cand = FeedCandidate(
        github_id=1, full_name="a/b", owner="a", name="b",
        url="https://github.com/a/b", stars=10, forks=1,
    )
    test_db.add(cand)
    test_db.commit()
    item = FeedItem(candidate_id=cand.id, feed_date=date(2026, 8, 1),
                    score=1.5, reason_json="{}")
    test_db.add(item)
    test_db.commit()
    assert test_db.query(FeedItem).one().candidate.full_name == "a/b"


def test_seen_repo_dismiss_default_false(test_db):
    test_db.add(SeenRepo(github_id=1, full_name="a/b"))
    test_db.commit()
    assert test_db.query(SeenRepo).one().dismissed is False


def test_exclude_term(test_db):
    test_db.add(ExcludeTerm(term="awesome"))
    test_db.commit()
    assert test_db.query(ExcludeTerm).one().term == "awesome"
