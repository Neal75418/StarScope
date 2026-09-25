"""刪除之後的新列不能被舊游標蓋掉。

三張來源表沒有 AUTOINCREMENT：最大的那幾列被刪掉之後，新列會重用 id。會刪這三張表的
路徑（刪警報規則、永久刪 repo、context 訊號清理）刪完都要把游標壓到現有最大 id；
重設所有資料則直接清掉游標（見 test_app_settings_router）。
"""

from datetime import timedelta

from constants import ContextSignalType, EarlySignalSeverity, EarlySignalType
from db.models import AlertRule, ContextSignal, EarlySignal, Repo, TriggeredAlert
from services.context_fetcher import cleanup_old_context_signals
from utils.time import utc_now


def _see_everything(client):
    cursor = client.get("/api/digest").json()["data"]["cursor"]
    client.post("/api/digest/seen", json={"cursor": cursor})


def _digest(client):
    return client.get("/api/digest").json()["data"]


def _keys(client):
    return [i["key"] for i in _digest(client)["items"]]


def _rule(db):
    rule = AlertRule(name="fast", signal_type="velocity", operator=">", threshold=1.0,
                     repo_id=None, enabled=True)
    db.add(rule)
    db.commit()
    return rule


def _alert(db, rule, repo):
    alert = TriggeredAlert(rule_id=rule.id, repo_id=repo.id, signal_value=5.0)
    db.add(alert)
    db.commit()
    return alert


def _signal(db, repo, severity):
    signal = EarlySignal(repo_id=repo.id, signal_type=EarlySignalType.BREAKOUT, severity=severity,
                         description="d", velocity_value=30.0, baseline_value=10.0,
                         detected_at=utc_now(), expires_at=utc_now() + timedelta(days=7))
    db.add(signal)
    db.commit()
    return signal


def _release(db, repo, external_id, fetched_days_ago=0):
    row = ContextSignal(repo_id=repo.id, signal_type=ContextSignalType.RELEASE,
                        external_id=external_id, title=f"v{external_id}", url="https://example.com",
                        published_at=utc_now(),
                        fetched_at=utc_now() - timedelta(days=fetched_days_ago))
    db.add(row)
    db.commit()
    return row


def test_alert_after_deleting_a_rule_is_not_hidden(client, test_db, mock_repo):
    old_rule = _rule(test_db)
    old_ids = [_alert(test_db, old_rule, mock_repo).id for _ in range(3)]
    _see_everything(client)
    last_seen = _digest(client)["last_seen_at"]

    client.delete(f"/api/alerts/rules/{old_rule.id}")  # cascade 刪掉三筆 triggered_alerts
    new = _alert(test_db, _rule(test_db), mock_repo)

    assert new.id in old_ids  # 前提：id 真的被重用了
    assert _keys(client) == [f"alert:{new.id}"]
    # 壓游標不是「看過」：上次看過的時間不能被改掉
    assert _digest(client)["last_seen_at"] == last_seen


def test_signal_after_deleting_a_repo_is_not_hidden(client, test_db, mock_repo):
    archived = Repo(owner="o", name="gone", full_name="o/gone", url="https://github.com/o/gone",
                    github_id=999, unstarred_at=utc_now())  # 已封存才能永久刪除
    test_db.add(archived)
    test_db.commit()
    _signal(test_db, mock_repo, EarlySignalSeverity.LOW)
    doomed = _signal(test_db, archived, EarlySignalSeverity.HIGH)  # 全表最大 id
    _see_everything(client)

    client.delete(f"/api/repos/{archived.id}")
    new = _signal(test_db, mock_repo, EarlySignalSeverity.HIGH)

    assert new.id == doomed.id
    assert _keys(client) == [f"signal:{new.id}"]


def test_release_after_context_cleanup_is_not_hidden(client, test_db, mock_repo):
    _release(test_db, mock_repo, "keep")
    pruned_id = _release(test_db, mock_repo, "pruned", fetched_days_ago=1).id  # 最大 id、但最舊
    _see_everything(client)

    cleanup_old_context_signals(test_db, max_per_repo=1)
    # bulk delete 不同步 session：被刪的物件還在 identity map，重用同一個 id 時會撞
    test_db.expunge_all()
    new = _release(test_db, mock_repo, "new")

    assert new.id == pruned_id
    assert _keys(client) == [f"release:{new.id}"]
