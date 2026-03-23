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
from db.models import AppSetting, AppSettingKey, Repo, RepoSnapshot, Signal, AlertRule, TriggeredAlert, EarlySignal, ContextSignal, SimilarRepo, RepoCategory, Category
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
