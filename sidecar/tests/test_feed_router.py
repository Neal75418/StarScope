"""Feed API 端點測試。generate 以 patch generate_feed 隔離，不打真 API。"""
import json
from datetime import date
from unittest.mock import AsyncMock, patch

from db.models import FeedCandidate, FeedItem, SeenRepo

TODAY = date(2026, 8, 1)


def _seed_item(db, gid=1, full_name="a/one", feedback=None):
    cand = FeedCandidate(github_id=gid, full_name=full_name, owner="a",
                         name=full_name.split("/")[1],
                         url=f"https://github.com/{full_name}",
                         stars=100, forks=2, topics=json.dumps(["tauri"]))
    db.add(cand)
    db.flush()
    item = FeedItem(candidate_id=cand.id, feed_date=TODAY, score=2.5,
                    reason_json=json.dumps({"matched": ["topic:tauri"],
                                            "stars": 100, "age_days": 45}),
                    feedback=feedback)
    db.add(item)
    db.add(SeenRepo(github_id=gid, full_name=full_name))
    db.commit()
    return item


def test_get_feed_empty(client):
    resp = client.get("/api/feed", params={"feed_date": "2026-08-01"})
    assert resp.status_code == 200
    assert resp.json()["data"]["items"] == []


def test_get_feed_returns_items_with_reason(client, test_db):
    _seed_item(test_db)
    resp = client.get("/api/feed", params={"feed_date": "2026-08-01"})
    items = resp.json()["data"]["items"]
    assert len(items) == 1
    assert items[0]["full_name"] == "a/one"
    assert items[0]["reason"]["matched"] == ["topic:tauri"]
    assert items[0]["topics"] == ["tauri"]


def test_get_feed_invalid_date_422(client):
    assert client.get("/api/feed", params={"feed_date": "not-a-date"}).status_code == 422


def test_generate_calls_pipeline(client):
    with patch("routers.feed.generate_feed", new=AsyncMock(return_value=7)) as mock_gen:
        resp = client.post("/api/feed/generate")
    assert resp.status_code == 200
    assert resp.json()["data"]["generated"] == 7
    mock_gen.assert_awaited_once()


def test_feedback_dismiss_marks_seen_dismissed(client, test_db):
    item = _seed_item(test_db)
    resp = client.post(f"/api/feed/items/{item.id}/feedback",
                       json={"action": "dismissed"})
    assert resp.status_code == 200
    assert resp.json()["data"]["feedback"] == "dismissed"
    assert test_db.query(SeenRepo).one().dismissed is True


def test_feedback_starred(client, test_db):
    item = _seed_item(test_db)
    resp = client.post(f"/api/feed/items/{item.id}/feedback",
                       json={"action": "starred"})
    assert resp.json()["data"]["feedback"] == "starred"


def test_feedback_invalid_action_422(client, test_db):
    item = _seed_item(test_db)
    assert client.post(f"/api/feed/items/{item.id}/feedback",
                       json={"action": "meh"}).status_code == 422


def test_feedback_missing_item_404(client):
    assert client.post("/api/feed/items/999/feedback",
                       json={"action": "dismissed"}).status_code == 404
