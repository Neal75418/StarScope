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


def test_exclusion_rejects_terms_that_normalize_too_short(client):
    """c++ / c# / ++ 正規化後都塌成 <2 字元，放行只會讓使用者看到無效的黑名單項。"""
    for bad in ("c++", "c#", "++"):
        resp = client.post("/api/interests/exclusions", json={"term": bad})
        assert resp.status_code == 422, f"{bad} 應被拒絕"
    # 正常詞不受影響
    assert client.post("/api/interests/exclusions", json={"term": "node.js"}).status_code == 200
