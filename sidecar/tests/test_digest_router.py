"""/api/digest：GET 取這批、POST 推進游標；游標只進不退。"""

from constants import ContextSignalType
from db.models import ContextSignal
from utils.time import utc_now


def _add_release(db, repo, external_id):
    row = ContextSignal(repo_id=repo.id, signal_type=ContextSignalType.RELEASE,
                        external_id=external_id, title=f"v{external_id}",
                        url="https://example.com", published_at=utc_now())
    db.add(row)
    db.commit()
    return row


def test_get_returns_the_batch_and_cursor(client, test_db, mock_repo):
    row = _add_release(test_db, mock_repo, "1")

    data = client.get("/api/digest").json()["data"]

    assert [i["key"] for i in data["items"]] == [f"release:{row.id}"]
    assert data["cursor"]["context_signal_id"] == row.id
    assert data["last_seen_at"] is None
    assert data["other_total"] == 1


def test_seen_hides_the_batch_next_time(client, test_db, mock_repo):
    _add_release(test_db, mock_repo, "1")
    data = client.get("/api/digest").json()["data"]

    client.post("/api/digest/seen", json={"cursor": data["cursor"]})
    again = client.get("/api/digest").json()["data"]

    assert again["items"] == []
    assert again["last_seen_at"].endswith("+00:00")


def test_row_written_between_get_and_post_still_shows_next_time(client, test_db, mock_repo):
    _add_release(test_db, mock_repo, "1")
    cursor = client.get("/api/digest").json()["data"]["cursor"]
    late = _add_release(test_db, mock_repo, "2")  # collector 在使用者看的時候寫進來

    client.post("/api/digest/seen", json={"cursor": cursor})

    keys = [i["key"] for i in client.get("/api/digest").json()["data"]["items"]]
    assert keys == [f"release:{late.id}"]


def test_seen_never_moves_the_cursor_backwards(client, test_db, mock_repo):
    _add_release(test_db, mock_repo, "1")
    cursor = client.get("/api/digest").json()["data"]["cursor"]
    client.post("/api/digest/seen", json={"cursor": cursor})

    resp = client.post("/api/digest/seen", json={"cursor": {
        "context_signal_id": 0, "early_signal_id": 0, "triggered_alert_id": 0}})

    assert resp.json()["data"]["context_signal_id"] == cursor["context_signal_id"]
    assert client.get("/api/digest").json()["data"]["items"] == []


def test_seen_rejects_negative_ids(client):
    resp = client.post("/api/digest/seen", json={"cursor": {
        "context_signal_id": -1, "early_signal_id": 0, "triggered_alert_id": 0}})

    assert resp.status_code == 422


def test_seen_with_ids_beyond_what_exists_is_clamped(client, test_db, mock_repo):
    # 送錯或 reset 之後送來的舊 cursor：寫進去的話摘要會空到 id 追上它；
    # 超出 SQLite INTEGER 的值更會讓之後每次 GET 都 500
    client.post("/api/digest/seen", json={"cursor": {
        "context_signal_id": 2**63, "early_signal_id": 10**9, "triggered_alert_id": 0}})

    row = _add_release(test_db, mock_repo, "1")
    resp = client.get("/api/digest")

    assert resp.status_code == 200
    assert [i["key"] for i in resp.json()["data"]["items"]] == [f"release:{row.id}"]
