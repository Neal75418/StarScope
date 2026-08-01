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


def test_feed_item_cascade_delete(test_db):
    """Verify that deleting a FeedCandidate cascades to its FeedItems."""
    cand = FeedCandidate(
        github_id=2, full_name="x/y", owner="x", name="y",
        url="https://github.com/x/y", stars=5, forks=0,
    )
    test_db.add(cand)
    test_db.commit()

    # Add multiple FeedItems linked to the candidate
    item1 = FeedItem(candidate_id=cand.id, feed_date=date(2026, 8, 1),
                     score=1.0, reason_json="{}")
    item2 = FeedItem(candidate_id=cand.id, feed_date=date(2026, 8, 2),
                     score=1.5, reason_json="{}")
    test_db.add_all([item1, item2])
    test_db.commit()

    # Verify items exist
    assert test_db.query(FeedItem).filter_by(candidate_id=cand.id).count() == 2

    # Delete the candidate
    test_db.delete(cand)
    test_db.commit()

    # Verify cascade deleted all associated items
    assert test_db.query(FeedItem).filter_by(candidate_id=cand.id).count() == 0
