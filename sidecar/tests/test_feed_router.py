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
                                            "stars": 100, "age_days": 45,
                                            "pushed_at": "2026-07-31T14:43:41Z"}),
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


def test_get_feed_exposes_pushed_at_for_liveness_judgement(client, test_db):
    # 「這專案還活著嗎」是決定要不要追蹤的關鍵；pushed_at 早就寫在 reason_json，
    # 這個測試釘住它必須被輸出給前端。
    _seed_item(test_db)
    items = client.get("/api/feed", params={"feed_date": "2026-08-01"}).json()["data"]["items"]
    assert items[0]["reason"]["pushed_at"] == "2026-07-31T14:43:41Z"


def test_get_feed_pushed_at_is_none_when_absent(client, test_db):
    # 舊資料或 GitHub 未回傳 pushed_at 時不得炸掉，回 None 即可。
    cand = FeedCandidate(github_id=9, full_name="b/two", owner="b", name="two",
                         url="https://github.com/b/two", stars=5, forks=0)
    test_db.add(cand)
    test_db.flush()
    test_db.add(FeedItem(candidate_id=cand.id, feed_date=TODAY, score=1.0,
                         reason_json=json.dumps({"matched": [], "stars": 5})))
    test_db.commit()
    items = client.get("/api/feed", params={"feed_date": "2026-08-01"}).json()["data"]["items"]
    assert items[0]["reason"]["pushed_at"] is None


def test_get_feed_invalid_date_422(client):
    assert client.get("/api/feed", params={"feed_date": "not-a-date"}).status_code == 422


def test_get_feed_defaults_to_local_today_not_utc(client, test_db):
    # feed_date 的預設值必須來自 local_today()，而不是 UTC 日期
    # （兩者在時區偏移的時段會錯配，見 utils/time.local_today 的說明）。
    _seed_item(test_db)  # feed_date=TODAY=2026-08-01
    with patch("routers.feed.local_today", return_value=TODAY):
        resp = client.get("/api/feed")
    assert resp.json()["data"]["feed_date"] == "2026-08-01"
    assert len(resp.json()["data"]["items"]) == 1


def test_generate_calls_pipeline(client):
    with patch("routers.feed.generate_feed", new=AsyncMock(return_value=7)) as mock_gen:
        resp = client.post("/api/feed/generate")
    assert resp.status_code == 200
    assert resp.json()["data"]["generated"] == 7
    mock_gen.assert_awaited_once()


def test_generate_uses_local_today_as_feed_date(client):
    # trigger_generate 的 feed_date 同樣必須來自 local_today()
    with patch("routers.feed.local_today", return_value=TODAY), \
         patch("routers.feed.generate_feed", new=AsyncMock(return_value=3)) as mock_gen:
        resp = client.post("/api/feed/generate")
    assert resp.json()["data"]["feed_date"] == "2026-08-01"
    _db_arg, _github_arg, feed_date_arg = mock_gen.call_args.args
    assert feed_date_arg == TODAY


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


# --- 點開記錄與成效統計 ---


def test_opened_records_first_click_and_does_not_overwrite(client, test_db):
    """重複點只留第一次的時間。

    保留的資訊是「這則 feed 多久之後首次引起興趣」；若每次點都覆蓋，
    那個間隔就變成「最後一次點」，完全是另一件事。
    """
    item = _seed_item(test_db)
    assert client.post(f"/api/feed/items/{item.id}/opened").status_code == 200

    test_db.expire_all()
    first = test_db.get(FeedItem, item.id).opened_at
    assert first is not None

    assert client.post(f"/api/feed/items/{item.id}/opened").status_code == 200
    test_db.expire_all()
    assert test_db.get(FeedItem, item.id).opened_at == first


def test_opened_and_feedback_coexist(client, test_db):
    """點開與加入必須能並存。

    這是「點開」不共用 feedback 欄位的全部理由：先點開看一眼、再決定要不要加，
    是最常見的路徑。共用一欄的話，加入會把點開記錄蓋掉，等於自己弄丟資料。
    """
    item = _seed_item(test_db)
    client.post(f"/api/feed/items/{item.id}/opened")
    client.post(f"/api/feed/items/{item.id}/feedback", json={"action": "starred"})

    test_db.expire_all()
    row = test_db.get(FeedItem, item.id)
    assert row.opened_at is not None, "加入追蹤不該抹掉點開記錄"
    assert row.feedback == "starred"


def test_opened_missing_item_404(client):
    assert client.post("/api/feed/items/999/opened").status_code == 404


def test_stats_counts_every_action_type(client, test_db):
    from utils.time import local_today

    today = local_today()
    opened = _seed_item(test_db, gid=11, full_name="a/opened")
    opened.feed_date = today
    starred = _seed_item(test_db, gid=12, full_name="a/starred", feedback="starred")
    starred.feed_date = today
    dismissed = _seed_item(test_db, gid=13, full_name="a/dismissed", feedback="dismissed")
    dismissed.feed_date = today
    test_db.commit()
    client.post(f"/api/feed/items/{opened.id}/opened")

    data = client.get("/api/feed/stats", params={"days": 30}).json()["data"]
    assert data == {"days": 30, "shown": 3, "opened": 1, "starred": 1, "dismissed": 1}


def test_stats_window_includes_the_oldest_day_and_excludes_the_one_before(client, test_db):
    """視窗邊界：days=7 要涵蓋今天在內的 7 個日曆日，第 8 天要被排除。

    差一天的錯誤在這種統計上不會報錯，只會讓數字悄悄偏掉。
    """
    from datetime import timedelta

    from utils.time import local_today

    today = local_today()
    inside = _seed_item(test_db, gid=21, full_name="a/inside")
    inside.feed_date = today - timedelta(days=6)
    outside = _seed_item(test_db, gid=22, full_name="a/outside")
    outside.feed_date = today - timedelta(days=7)
    test_db.commit()

    data = client.get("/api/feed/stats", params={"days": 7}).json()["data"]
    assert data["shown"] == 1
