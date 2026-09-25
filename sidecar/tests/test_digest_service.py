"""build_digest：分層、去重、篩選、上限。"""

from datetime import timedelta

from constants import ContextSignalType, EarlySignalSeverity, EarlySignalType
from db.models import AlertRule, AppSettingKey, ContextSignal, EarlySignal, TriggeredAlert
from services.digest import DigestCursor, build_digest
from services.release_fetcher import _ReleaseTarget, store_release
from services.settings import set_setting
from utils.time import utc_now

ZERO = DigestCursor(0, 0, 0)


def _release(db, repo, *, tags=None, external_id="1", published_days_ago=0.0):
    row = ContextSignal(
        repo_id=repo.id, signal_type=ContextSignalType.RELEASE, external_id=external_id,
        title=f"v{external_id}", url=f"https://github.com/{repo.full_name}/releases/{external_id}",
        tags=tags, published_at=utc_now() - timedelta(days=published_days_ago),
    )
    db.add(row)
    db.commit()
    return row


def _hn(db, repo, *, score, external_id="h1", title="Show HN: thing"):
    row = ContextSignal(
        repo_id=repo.id, signal_type=ContextSignalType.HACKER_NEWS, external_id=external_id,
        title=title, url=f"https://news.ycombinator.com/item?id={external_id}",
        score=score, published_at=utc_now(),
    )
    db.add(row)
    db.commit()
    return row


def _signal(db, repo, *, severity, signal_type=EarlySignalType.SUDDEN_SPIKE,
            context_title=None, acknowledged=False, detected_days_ago=0.0):
    row = EarlySignal(
        repo_id=repo.id, signal_type=signal_type, severity=severity, description="d",
        velocity_value=300.0, baseline_value=40.0, star_count=5000, context_title=context_title,
        detected_at=utc_now() - timedelta(days=detected_days_ago),
        expires_at=utc_now() + timedelta(days=3), acknowledged=acknowledged,
    )
    db.add(row)
    db.commit()
    return row


def _keys(digest, tier=None):
    return [i["key"] for i in digest["items"] if tier is None or i["tier"] == tier]


class TestTiers:
    def test_breaking_or_security_release_is_a_highlight(self, test_db, mock_repo):
        a = _release(test_db, mock_repo, tags="breaking", external_id="1")
        b = _release(test_db, mock_repo, tags="deprecation,security", external_id="2")

        digest = build_digest(test_db, ZERO)

        assert set(_keys(digest, "highlight")) == {f"release:{a.id}", f"release:{b.id}"}

    def test_plain_and_deprecation_only_releases_are_other(self, test_db, mock_repo):
        plain = _release(test_db, mock_repo, tags=None, external_id="1")
        deprecation = _release(test_db, mock_repo, tags="deprecation", external_id="2")

        digest = build_digest(test_db, ZERO)

        assert set(_keys(digest, "other")) == {f"release:{plain.id}", f"release:{deprecation.id}"}
        item = next(i for i in digest["items"] if i["key"] == f"release:{deprecation.id}")
        assert item["tags"] == ["deprecation"]

    def test_hn_threshold_is_50(self, test_db, mock_repo):
        low = _hn(test_db, mock_repo, score=49, external_id="a")
        high = _hn(test_db, mock_repo, score=50, external_id="b")

        digest = build_digest(test_db, ZERO)

        assert _keys(digest, "highlight") == [f"hn:{high.id}"]
        assert _keys(digest, "other") == [f"hn:{low.id}"]

    def test_signal_severity_decides_the_tier(self, test_db, mock_repo):
        low = _signal(test_db, mock_repo, severity=EarlySignalSeverity.LOW)
        medium = _signal(test_db, mock_repo, severity=EarlySignalSeverity.MEDIUM,
                         signal_type=EarlySignalType.BREAKOUT)

        digest = build_digest(test_db, ZERO)

        assert _keys(digest, "highlight") == [f"signal:{medium.id}"]
        assert _keys(digest, "other") == [f"signal:{low.id}"]
        sig = next(i for i in digest["items"] if i["key"] == f"signal:{medium.id}")["signal"]
        # 前端用 formatSignalDescription 渲染，欄位要跟 EarlySignalResponse 一致
        assert sig["repo_name"] == mock_repo.full_name
        assert sig["baseline_value"] == 40.0

    def test_triggered_alert_is_a_highlight(self, test_db, mock_repo):
        rule = AlertRule(name="fast", signal_type="velocity", operator=">", threshold=10.0,
                         repo_id=None, enabled=True)
        test_db.add(rule)
        test_db.commit()
        alert = TriggeredAlert(rule_id=rule.id, repo_id=mock_repo.id, signal_value=42.0)
        test_db.add(alert)
        test_db.commit()

        digest = build_digest(test_db, ZERO)

        item = next(i for i in digest["items"] if i["key"] == f"alert:{alert.id}")
        assert item["tier"] == "highlight"
        assert (item["rule_name"], item["operator"], item["threshold"], item["value"]) == (
            "fast", ">", 10.0, 42.0)


    def test_viral_hn_signal_below_its_severity_cutoff_is_still_a_highlight(self, test_db, mock_repo):
        # viral_hn 的嚴重度門檻比摘要的 HN 門檻高（100–199 分會是 low）。同一則討論沒被訊號化時
        # ≥ 50 分就是重點，去重改由訊號代表它之後不能因此降級
        viral = _signal(test_db, mock_repo, severity=EarlySignalSeverity.LOW,
                        signal_type=EarlySignalType.VIRAL_HN, context_title="Show HN: thing")
        viral.velocity_value = 150.0  # viral_hn 的 velocity_value 存的是 HN 分數
        test_db.commit()

        assert _keys(build_digest(test_db, ZERO), "highlight") == [f"signal:{viral.id}"]


class TestFiltering:
    def test_viral_hn_story_appears_once_as_the_signal(self, test_db, mock_repo):
        title = "Show HN: " + "x" * 300  # 超過 255：context_title 寫入時被截斷
        story = _hn(test_db, mock_repo, score=320, title=title)
        viral = _signal(test_db, mock_repo, severity=EarlySignalSeverity.HIGH,
                        signal_type=EarlySignalType.VIRAL_HN, context_title=title[:255])

        digest = build_digest(test_db, ZERO)

        assert f"signal:{viral.id}" in _keys(digest)
        assert f"hn:{story.id}" not in _keys(digest)

    def test_acknowledged_signals_are_left_out(self, test_db, mock_repo):
        _signal(test_db, mock_repo, severity=EarlySignalSeverity.HIGH, acknowledged=True)

        assert build_digest(test_db, ZERO)["items"] == []

    def test_acknowledged_alerts_are_left_out(self, test_db, mock_repo):
        # 在通知中心按掉的警報已經看過了
        rule = AlertRule(name="fast", signal_type="velocity", operator=">", threshold=10.0,
                         repo_id=None, enabled=True)
        test_db.add(rule)
        test_db.commit()
        test_db.add(TriggeredAlert(rule_id=rule.id, repo_id=mock_repo.id, signal_value=42.0,
                                   acknowledged=True, acknowledged_at=utc_now()))
        test_db.commit()

        assert build_digest(test_db, ZERO)["items"] == []

    def test_unstarred_repos_are_left_out(self, test_db, mock_repo):
        _release(test_db, mock_repo, tags="security")
        mock_repo.unstarred_at = utc_now()
        test_db.commit()

        assert build_digest(test_db, ZERO)["items"] == []

    def test_only_rows_newer_than_the_cursor(self, test_db, mock_repo):
        old = _release(test_db, mock_repo, external_id="1")
        new = _release(test_db, mock_repo, external_id="2")

        digest = build_digest(test_db, DigestCursor(old.id, 0, 0))

        assert _keys(digest) == [f"release:{new.id}"]
        assert digest["cursor"]["context_signal_id"] == new.id

    def test_refetching_a_seen_release_does_not_bring_it_back(self, test_db, mock_repo):
        # collector 每小時重抓：upsert 會刷新 fetched_at 與標題，id 不變
        target = _ReleaseTarget(mock_repo.id, mock_repo.owner, mock_repo.name, mock_repo.full_name)
        release = {"id": 777, "tag_name": "v1.0.0", "name": "v1.0.0",
                   "html_url": "https://example.com/r", "published_at": "2026-09-20T00:00:00Z",
                   "body": "BREAKING CHANGE: everything"}
        store_release(target, release, test_db)
        test_db.commit()
        seen = build_digest(test_db, ZERO)["cursor"]

        store_release(target, {**release, "name": "v1.0.0 (edited)"}, test_db)
        test_db.commit()

        assert build_digest(test_db, DigestCursor(**seen))["items"] == []

    def test_first_visit_shows_only_the_last_three_days(self, test_db, mock_repo):
        _release(test_db, mock_repo, external_id="old", published_days_ago=5)
        recent = _release(test_db, mock_repo, external_id="new", published_days_ago=1)
        _signal(test_db, mock_repo, severity=EarlySignalSeverity.HIGH, detected_days_ago=4)

        digest = build_digest(test_db, None)

        assert _keys(digest) == [f"release:{recent.id}"]

    def test_first_visit_cursor_covers_everything_that_exists(self, test_db, mock_repo):
        # 窗口外的舊列也要被游標蓋過，否則下次打開會把全部歷史倒出來
        old = _release(test_db, mock_repo, external_id="old", published_days_ago=30)
        old_signal = _signal(test_db, mock_repo, severity=EarlySignalSeverity.LOW,
                             detected_days_ago=30)

        cursor = build_digest(test_db, None)["cursor"]

        assert cursor["context_signal_id"] == old.id
        assert cursor["early_signal_id"] == old_signal.id


    def test_rows_committed_while_building_are_left_for_next_time(self, test_db, mock_repo, monkeypatch):
        # collector 在 build_digest 取完上界之後才寫入的列：這一批不含、cursor 也不越過，下一批出現
        import services.digest as digest_module

        early = _release(test_db, mock_repo, external_id="early")
        rule = AlertRule(name="fast", signal_type="velocity", operator=">", threshold=1.0,
                         repo_id=None, enabled=True)
        test_db.add(rule)
        test_db.commit()
        real_max_ids = digest_module._current_max_ids
        late: dict[str, int] = {}

        def capture_then_write(db):
            upper = real_max_ids(db)
            late["release"] = _release(test_db, mock_repo, external_id="late").id
            late["signal"] = _signal(test_db, mock_repo, severity=EarlySignalSeverity.HIGH).id
            alert = TriggeredAlert(rule_id=rule.id, repo_id=mock_repo.id, signal_value=5.0)
            test_db.add(alert)
            test_db.commit()
            late["alert"] = alert.id
            return upper

        monkeypatch.setattr(digest_module, "_current_max_ids", capture_then_write)
        first = build_digest(test_db, ZERO)
        monkeypatch.undo()

        assert _keys(first) == [f"release:{early.id}"]
        second = build_digest(test_db, DigestCursor(**first["cursor"]))
        assert set(_keys(second)) == {
            f"release:{late['release']}", f"signal:{late['signal']}", f"alert:{late['alert']}"}


class TestShape:
    def test_other_is_capped_at_50_with_a_total(self, test_db, mock_repo):
        for n in range(55):
            _release(test_db, mock_repo, external_id=str(n))
        _release(test_db, mock_repo, tags="security", external_id="sec")

        digest = build_digest(test_db, ZERO)

        assert len(_keys(digest, "other")) == 50
        assert digest["other_total"] == 55
        assert len(_keys(digest, "highlight")) == 1

    def test_cursor_skips_past_items_beyond_the_cap(self, test_db, mock_repo):
        rows = [_release(test_db, mock_repo, external_id=str(n)) for n in range(55)]

        digest = build_digest(test_db, ZERO)

        assert digest["cursor"]["context_signal_id"] == max(r.id for r in rows)

    def test_highlights_come_first_newest_first(self, test_db, mock_repo):
        older = _release(test_db, mock_repo, tags="security", external_id="1", published_days_ago=2)
        newer = _release(test_db, mock_repo, tags="breaking", external_id="2", published_days_ago=1)
        plain = _release(test_db, mock_repo, external_id="3", published_days_ago=0)

        assert _keys(build_digest(test_db, ZERO)) == [
            f"release:{newer.id}", f"release:{older.id}", f"release:{plain.id}"]

    def test_occurred_at_carries_the_utc_offset(self, test_db, mock_repo):
        _release(test_db, mock_repo)

        item = build_digest(test_db, ZERO)["items"][0]

        assert item["occurred_at"].endswith("+00:00")

    def test_signal_items_link_to_the_repo(self, test_db, mock_repo):
        _signal(test_db, mock_repo, severity=EarlySignalSeverity.HIGH)

        item = build_digest(test_db, ZERO)["items"][0]

        assert item["url"] is None
        assert item["repo"]["url"] == mock_repo.url

    def test_releases_checked_follows_the_last_fetch_setting(self, test_db):
        assert build_digest(test_db, ZERO)["releases_checked"] is False
        set_setting(AppSettingKey.LAST_RELEASE_FETCH_AT, utc_now().isoformat(), test_db)
        assert build_digest(test_db, ZERO)["releases_checked"] is True
