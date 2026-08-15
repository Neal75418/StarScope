"""Interests CRUD 與黑名單 API 測試。"""
BASE = "/api/interests"


def test_list_empty(client):
    resp = client.get(BASE)
    assert resp.status_code == 200
    assert resp.json()["data"]["interests"] == []


def test_create_interest(client):
    resp = client.post(BASE, json={"term": "tauri", "kind": "topic", "weight": 3})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["term"] == "tauri" and data["weight"] == 3


def test_create_duplicate_term_kind_conflict(client):
    client.post(BASE, json={"term": "tauri", "kind": "topic", "weight": 2})
    resp = client.post(BASE, json={"term": "tauri", "kind": "topic", "weight": 1})
    assert resp.status_code == 409


def test_create_invalid_weight_rejected(client):
    resp = client.post(BASE, json={"term": "x", "kind": "topic", "weight": 4})
    assert resp.status_code == 422


def test_create_invalid_kind_rejected(client):
    resp = client.post(BASE, json={"term": "x", "kind": "banana", "weight": 2})
    assert resp.status_code == 422


def test_update_interest(client):
    created = client.post(BASE, json={"term": "rust", "kind": "language", "weight": 1})
    iid = created.json()["data"]["id"]
    resp = client.put(f"{BASE}/{iid}", json={"term": "rust", "kind": "language", "weight": 3})
    assert resp.status_code == 200
    assert resp.json()["data"]["weight"] == 3


def test_update_missing_404(client):
    resp = client.put(f"{BASE}/999", json={"term": "x", "kind": "topic", "weight": 1})
    assert resp.status_code == 404


def test_update_duplicate_term_kind_conflict(client):
    # Create two interests with different terms
    resp1 = client.post(BASE, json={"term": "rust", "kind": "language", "weight": 1})
    id1 = resp1.json()["data"]["id"]
    resp2 = client.post(BASE, json={"term": "python", "kind": "language", "weight": 2})
    id2 = resp2.json()["data"]["id"]
    # Try to update the second to have the same (term, kind) as the first -> should get 409
    resp = client.put(f"{BASE}/{id2}", json={"term": "rust", "kind": "language", "weight": 3})
    assert resp.status_code == 409


def test_delete_interest(client):
    created = client.post(BASE, json={"term": "rust", "kind": "language", "weight": 1})
    iid = created.json()["data"]["id"]
    assert client.delete(f"{BASE}/{iid}").status_code == 200
    assert client.get(BASE).json()["data"]["interests"] == []


def test_exclusions_seeded_with_defaults(client):
    resp = client.get(f"{BASE}/exclusions")
    terms = {e["term"] for e in resp.json()["data"]["exclusions"]}
    assert terms == {"awesome", "interview", "roadmap", "tutorial"}


def test_add_and_remove_exclusion(client):
    resp = client.post(f"{BASE}/exclusions", json={"term": "boilerplate"})
    assert resp.status_code == 200
    tid = resp.json()["data"]["id"]
    assert client.delete(f"{BASE}/exclusions/{tid}").status_code == 200


def test_validation_error_detail_is_a_readable_string(client):
    """422 的 detail 必須是可讀字串而非陣列。

    FastAPI 預設回 [{type, loc, msg, input}, ...]，前端 client.ts 取 error.detail
    會拿到陣列、最後顯示泛用錯誤——使用者看到的跟斷網一樣，不知道哪裡不合法。
    """
    resp = client.post("/api/interests/exclusions", json={"term": "c++"})

    assert resp.status_code == 422
    body = resp.json()
    assert isinstance(body["detail"], str), "detail 不能是陣列，前端無法呈現"
    assert "at least 2 letters" in body["detail"]
    assert body["code"] == "VALIDATION_ERROR"


def test_exclusion_rejects_terms_that_normalize_too_short(client):
    """c++ / c# / ++ 正規化後都塌成 <2 字元，放行只會讓使用者看到無效的黑名單項。"""
    for bad in ("c++", "c#", "++"):
        resp = client.post("/api/interests/exclusions", json={"term": bad})
        assert resp.status_code == 422, f"{bad} 應被拒絕"
    # 正常詞不受影響
    assert client.post("/api/interests/exclusions", json={"term": "node.js"}).status_code == 200


def test_trending_timestamp_carries_timezone(client, monkeypatch):
    """computed_at 必須帶時區標記。

    utc_now() 回傳 naive datetime（為了 SQLite 比較一致），直接 isoformat()
    會產生 "2026-08-15T13:53:53" 這種沒有時區的字串——前端 new Date() 會把它
    當成本地時間，在 UTC+8 就顯示成「8 小時前」，但其實是剛剛跑完的。
    """
    from services import trending_topics

    monkeypatch.setattr(trending_topics, "compute_trending_topics", None)  # 不會被呼叫
    from db.database import SessionLocal

    db = SessionLocal()
    try:
        computed_at = trending_topics.save_cache(db, [])
    finally:
        db.close()

    assert computed_at.endswith("Z"), f"缺少時區標記，前端會誤判時間: {computed_at}"

    resp = client.get("/api/interests/trending")
    assert resp.status_code == 200
    assert resp.json()["data"]["computed_at"].endswith("Z")


def test_trending_already_added_follows_the_live_interest_list(client):
    """already_added 必須在讀取時重算，不能跟著主題快取一起凍結。

    主題快取一次可以放上一整週，興趣清單卻隨時會變。若把這個欄位存進快取，
    加入之後按鈕仍顯示「+」，再按一次拿到 409——看起來就像加不進去。
    """
    from db.database import SessionLocal
    from services.trending_topics import TrendingTopic, save_cache

    db = SessionLocal()
    try:
        save_cache(db, [TrendingTopic("claude", sample_count=12, global_count=900, heat=1333.3)])
    finally:
        db.close()

    def added_flag() -> bool:
        topics = client.get("/api/interests/trending").json()["data"]["topics"]
        return next(t["already_added"] for t in topics if t["topic"] == "claude")

    assert added_flag() is False

    created = client.post("/api/interests", json={"term": "claude", "kind": "topic", "weight": 2})
    assert created.status_code == 200
    # 快取沒有重算過，但旗標必須已經翻過來
    assert added_flag() is True

    client.delete(f"/api/interests/{created.json()['data']['id']}")
    assert added_flag() is False
