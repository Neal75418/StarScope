"""
Tests for app_settings endpoints.
"""

import pytest
import services.anomaly_detector as _detector
from unittest.mock import patch, MagicMock


@pytest.fixture(autouse=True)
def reset_anomaly_detector_globals():
    """Restore anomaly detector module-level globals after each test.

    PUT /signal-thresholds calls reload_thresholds_from_db() which mutates
    module-level variables shared across all tests in the process.
    """
    original = {
        "RISING_STAR_MIN_VELOCITY": _detector.RISING_STAR_MIN_VELOCITY,
        "SUDDEN_SPIKE_MULTIPLIER": _detector.SUDDEN_SPIKE_MULTIPLIER,
        "BREAKOUT_VELOCITY_THRESHOLD": _detector.BREAKOUT_VELOCITY_THRESHOLD,
        "VIRAL_HN_MIN_SCORE": _detector.VIRAL_HN_MIN_SCORE,
    }
    yield
    for attr, value in original.items():
        setattr(_detector, attr, value)
from db.models import AppSetting, AppSettingKey, Repo, RepoSnapshot
from utils.time import utc_now


class TestGetFetchInterval:
    """Tests for GET /api/settings/fetch-interval."""

    def test_returns_default_when_not_set(self, client):
        resp = client.get("/api/settings/fetch-interval")
        assert resp.status_code == 200
        assert resp.json()["data"]["interval_minutes"] == 60

    def test_returns_stored_value(self, client, test_db):
        setting = AppSetting(key=AppSettingKey.FETCH_INTERVAL_MINUTES, value="360")
        test_db.add(setting)
        test_db.commit()
        resp = client.get("/api/settings/fetch-interval")
        assert resp.status_code == 200
        assert resp.json()["data"]["interval_minutes"] == 360


class TestUpdateFetchInterval:
    """Tests for PUT /api/settings/fetch-interval."""

    def test_updates_interval(self, client):
        resp = client.put("/api/settings/fetch-interval", json={"interval_minutes": 720})
        assert resp.status_code == 200
        assert resp.json()["data"]["interval_minutes"] == 720

    def test_persists_to_db(self, client, test_db):
        client.put("/api/settings/fetch-interval", json={"interval_minutes": 1440})
        setting = test_db.query(AppSetting).filter_by(key=AppSettingKey.FETCH_INTERVAL_MINUTES).first()
        assert setting is not None
        assert setting.value == "1440"

    def test_rejects_invalid_interval(self, client):
        resp = client.put("/api/settings/fetch-interval", json={"interval_minutes": 999})
        assert resp.status_code == 422

    def test_all_valid_intervals_accepted(self, client):
        for minutes in [60, 360, 720, 1440]:
            resp = client.put("/api/settings/fetch-interval", json={"interval_minutes": minutes})
            assert resp.status_code == 200

    def test_scheduler_reschedule_failure_is_logged_not_raised(self, client):
        """Scheduler failure should not cause endpoint to fail."""
        mock_scheduler = MagicMock()
        mock_scheduler.running = True
        mock_scheduler.reschedule_job.side_effect = Exception("scheduler error")
        with patch("services.scheduler.get_scheduler", return_value=mock_scheduler):
            resp = client.put("/api/settings/fetch-interval", json={"interval_minutes": 360})
        assert resp.status_code == 200

    def test_scheduler_not_running_is_skipped(self, client):
        mock_scheduler = MagicMock()
        mock_scheduler.running = False
        with patch("services.scheduler.get_scheduler", return_value=mock_scheduler):
            resp = client.put("/api/settings/fetch-interval", json={"interval_minutes": 360})
        assert resp.status_code == 200
        mock_scheduler.reschedule_job.assert_not_called()


class TestGetSnapshotRetention:
    """Tests for GET /api/settings/snapshot-retention."""

    def test_returns_default_when_not_set(self, client):
        resp = client.get("/api/settings/snapshot-retention")
        assert resp.status_code == 200
        assert resp.json()["data"]["retention_days"] == 90

    def test_returns_stored_value(self, client, test_db):
        setting = AppSetting(key=AppSettingKey.SNAPSHOT_RETENTION_DAYS, value="180")
        test_db.add(setting)
        test_db.commit()
        resp = client.get("/api/settings/snapshot-retention")
        assert resp.json()["data"]["retention_days"] == 180


class TestUpdateSnapshotRetention:
    """Tests for PUT /api/settings/snapshot-retention."""

    def test_updates_retention(self, client):
        resp = client.put("/api/settings/snapshot-retention", json={"retention_days": 180})
        assert resp.status_code == 200
        assert resp.json()["data"]["retention_days"] == 180

    def test_rejects_below_minimum(self, client):
        resp = client.put("/api/settings/snapshot-retention", json={"retention_days": 29})
        assert resp.status_code == 422

    def test_rejects_above_maximum(self, client):
        resp = client.put("/api/settings/snapshot-retention", json={"retention_days": 731})
        assert resp.status_code == 422

    def test_accepts_boundary_values(self, client):
        for days in [30, 730]:
            resp = client.put("/api/settings/snapshot-retention", json={"retention_days": days})
            assert resp.status_code == 200


class TestGetSignalThresholds:
    """Tests for GET /api/settings/signal-thresholds."""

    def test_returns_defaults_when_not_set(self, client):
        resp = client.get("/api/settings/signal-thresholds")
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["rising_star_min_velocity"] == 10.0
        assert data["sudden_spike_multiplier"] == 3.0
        assert data["breakout_velocity_threshold"] == 2.0
        assert data["viral_hn_min_score"] == 100

    def test_returns_stored_values(self, client, test_db):
        for key, value in [
            (AppSettingKey.SIGNAL_RISING_STAR_MIN_VELOCITY, "20"),
            (AppSettingKey.SIGNAL_SUDDEN_SPIKE_MULTIPLIER, "5"),
            (AppSettingKey.SIGNAL_BREAKOUT_VELOCITY_THRESHOLD, "3"),
            (AppSettingKey.SIGNAL_VIRAL_HN_MIN_SCORE, "200"),
        ]:
            test_db.add(AppSetting(key=key, value=value))
        test_db.commit()
        resp = client.get("/api/settings/signal-thresholds")
        data = resp.json()["data"]
        assert data["rising_star_min_velocity"] == 20.0
        assert data["sudden_spike_multiplier"] == 5.0
        assert data["breakout_velocity_threshold"] == 3.0
        assert data["viral_hn_min_score"] == 200


class TestUpdateSignalThresholds:
    """Tests for PUT /api/settings/signal-thresholds."""

    def test_updates_all_thresholds(self, client):
        payload = {
            "rising_star_min_velocity": 15.0,
            "sudden_spike_multiplier": 4.0,
            "breakout_velocity_threshold": 3.0,
            "viral_hn_min_score": 150,
        }
        resp = client.put("/api/settings/signal-thresholds", json=payload)
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["rising_star_min_velocity"] == 15.0
        assert data["sudden_spike_multiplier"] == 4.0

    def test_partial_update(self, client):
        resp = client.put("/api/settings/signal-thresholds", json={"rising_star_min_velocity": 25.0})
        assert resp.status_code == 200
        assert resp.json()["data"]["rising_star_min_velocity"] == 25.0

    def test_empty_body_is_no_op(self, client):
        resp = client.put("/api/settings/signal-thresholds", json={})
        assert resp.status_code == 200

    def test_rejects_zero_velocity(self, client):
        resp = client.put("/api/settings/signal-thresholds", json={"rising_star_min_velocity": 0})
        assert resp.status_code == 422

    def test_rejects_negative_multiplier(self, client):
        resp = client.put("/api/settings/signal-thresholds", json={"sudden_spike_multiplier": -1.0})
        assert resp.status_code == 422

    def test_rejects_zero_hn_score(self, client):
        resp = client.put("/api/settings/signal-thresholds", json={"viral_hn_min_score": 0})
        assert resp.status_code == 422

    def test_rejects_negative_breakout_threshold(self, client):
        resp = client.put("/api/settings/signal-thresholds", json={"breakout_velocity_threshold": -0.5})
        assert resp.status_code == 422


class TestClearCache:
    """Tests for POST /api/settings/clear-cache."""

    def test_returns_ok(self, client):
        resp = client.post("/api/settings/clear-cache")
        assert resp.status_code == 200
        assert resp.json()["data"]["status"] == "ok"


class TestResetAllData:
    """Tests for POST /api/settings/reset-data."""

    def test_resets_empty_db(self, client):
        resp = client.post("/api/settings/reset-data", json={"confirm": "RESET"})
        assert resp.status_code == 200
        assert resp.json()["data"]["status"] == "reset"
        assert resp.json()["data"]["deleted_repos"] == 0

    def test_deletes_repos_and_returns_count(self, client, test_db, mock_repo):
        resp = client.post("/api/settings/reset-data", json={"confirm": "RESET"})
        assert resp.status_code == 200
        assert resp.json()["data"]["deleted_repos"] == 1
        assert test_db.query(Repo).count() == 0

    def test_deletes_related_data(self, client, test_db, mock_repo_with_snapshots):
        repo, snapshots = mock_repo_with_snapshots
        resp = client.post("/api/settings/reset-data", json={"confirm": "RESET"})
        assert resp.status_code == 200
        assert test_db.query(RepoSnapshot).count() == 0
        assert test_db.query(Repo).count() == 0

    def test_preserves_app_settings(self, client, test_db):
        setting = AppSetting(key=AppSettingKey.FETCH_INTERVAL_MINUTES, value="720")
        test_db.add(setting)
        test_db.commit()
        client.post("/api/settings/reset-data", json={"confirm": "RESET"})
        assert test_db.query(AppSetting).filter_by(key=AppSettingKey.FETCH_INTERVAL_MINUTES).count() == 1


class TestDiagnosticsBackupSurvivesRestart:
    """
    診斷的 last_backup 必須反映檔案系統，不是記憶體旗標——
    否則每次重開 App 都會謊稱「沒有備份」。
    """

    def test_reports_backup_from_disk_even_with_empty_health(self, client, monkeypatch):
        from datetime import datetime, timezone
        # get_scheduler_health 在函式內 import，要 patch 來源模組
        monkeypatch.setattr("services.scheduler.get_scheduler_health", lambda: {
            "last_fetch_success": None, "last_fetch_failure": None,
            "last_fetch_error": None, "last_alert_check": None, "last_backup": None,
        })
        monkeypatch.setattr("services.backup.find_latest_backup",
                            lambda *a, **k: datetime(2026, 8, 22, 18, 0, tzinfo=timezone.utc))

        body = client.get("/api/settings/diagnostics").json()["data"]

        assert body["last_backup"] is not None, (
            "記憶體旗標空著就回報沒有備份——但磁碟上有一個"
        )
        assert body["last_backup"].startswith("2026-08-22")

    def test_exposes_whether_a_fetch_is_running_right_now(self, client):
        """前端的「抓取中」讀這個欄位，不是自己的 promise。

        手動觸發撞到排程中的抓取時，POST 立刻回 409，本機 promise 當場結束，
        但抓取還在跑——實測 POST 14ms 返回而真正的抓取 12 秒後才完成。少了這個
        欄位，畫面在那 12 秒裡會謊稱已完成。
        """
        import asyncio
        from services.scheduler import _fetch_all_lock

        assert client.get("/api/settings/diagnostics").json()["data"]["fetch_in_progress"] is False

        async def _while_locked():
            async with _fetch_all_lock:
                return client.get("/api/settings/diagnostics").json()["data"]

        assert asyncio.run(_while_locked())["fetch_in_progress"] is True

        # 鎖放掉之後要跟著變回 False，否則按鈕會永遠停用
        assert client.get("/api/settings/diagnostics").json()["data"]["fetch_in_progress"] is False

    def test_reports_none_when_disk_has_no_backup(self, client, monkeypatch):
        monkeypatch.setattr("services.scheduler.get_scheduler_health", lambda: {
            "last_fetch_success": None, "last_fetch_failure": None,
            "last_fetch_error": None, "last_alert_check": None,
            # 記憶體說有，但磁碟沒有——以磁碟為準
            "last_backup": 1_700_000_000.0,
        })
        monkeypatch.setattr("services.backup.find_latest_backup", lambda *a, **k: None)

        body = client.get("/api/settings/diagnostics").json()["data"]

        assert body["last_backup"] is None


class TestDiagnosticsSnapshotFreshness:
    """「最近快照」要回答『資料多久前寫入』，而不是『距今天午夜多久』。"""

    def test_reports_write_time_not_the_calendar_date(self, client, test_db):
        """先前取的是 MAX(snapshot_date)——Date 欄位，序列化成 "2026-08-29" 後
        前端當午夜解析。於是這一格整天增長、午夜歸零，跟收集器有沒有在工作無關：
        當日停滯看起來與健康時一模一樣。2026-08-29 實測畫面說「14h」，
        實際最後一次寫入是 30 分鐘前。"""
        from datetime import date, datetime

        repo = Repo(owner="a", name="one", full_name="a/one",
                    url="https://github.com/a/one")
        test_db.add(repo)
        test_db.flush()

        written_at = datetime(2026, 8, 29, 13, 39, 11)
        test_db.add(RepoSnapshot(
            repo_id=repo.id, stars=1, forks=0, watchers=0, open_issues=0,
            snapshot_date=date(2026, 8, 29), fetched_at=written_at,
        ))
        test_db.commit()

        raw = client.get("/api/settings/diagnostics").json()["data"]["last_snapshot_at"]
        parsed = datetime.fromisoformat(raw)

        assert parsed.tzinfo is not None, (
            "沒有時區的字串會被 JS 當本地時間解析：UTC+8 之下年齡變負數，"
            "formatRelativeTime 的 guard 會讓它永遠顯示「剛剛」——"
            "從一個假數字換成另一個假數字"
        )
        assert parsed.replace(tzinfo=None) == written_at, (
            "回報的必須是寫入時刻，不是快照日期的午夜"
        )

    def test_offset_is_utc_and_backfilled_rows_report_their_write_time(self, client, test_db):
        """fetched_at 存的是 naive UTC，回報必須標 +00:00——標成別的時區（例如本機的 +08:00）
        會讓畫面差 8 小時，又是一個看起來合理的假數字。另外要取的是 max(fetched_at)：
        回填舊日期的快照 snapshot_date 較早、fetched_at 較晚，「最近寫入」必須是它。"""
        from datetime import date, datetime, timedelta

        repo = Repo(owner="a", name="one", full_name="a/one", url="https://github.com/a/one")
        test_db.add(repo)
        test_db.flush()
        test_db.add_all([
            RepoSnapshot(repo_id=repo.id, stars=1, forks=0, watchers=0, open_issues=0,
                         snapshot_date=date(2026, 8, 29), fetched_at=datetime(2026, 8, 29, 13, 39, 11)),
            RepoSnapshot(repo_id=repo.id, stars=1, forks=0, watchers=0, open_issues=0,
                         snapshot_date=date(2026, 8, 20), fetched_at=datetime(2026, 8, 29, 14, 0, 0)),
        ])
        test_db.commit()

        raw = client.get("/api/settings/diagnostics").json()["data"]["last_snapshot_at"]
        parsed = datetime.fromisoformat(raw)

        assert parsed.utcoffset() == timedelta(0), "必須是 UTC，不是任何本機時區"
        assert parsed.replace(tzinfo=None) == datetime(2026, 8, 29, 14, 0, 0), \
            "要的是最後一次寫入（回填那筆），不是 snapshot_date 最大那筆"
