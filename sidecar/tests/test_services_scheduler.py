"""
Tests for services/scheduler.py - Background scheduler service.
"""

from contextlib import contextmanager

import pytest
from unittest.mock import MagicMock, patch, AsyncMock


def _mock_db_ctx(db):
    """Create a context manager factory that yields the given db session.

    Returns the factory (not an instance) so each call produces a fresh,
    reusable context manager.  Use with ``patch(..., new=_mock_db_ctx(db))``.
    """
    @contextmanager
    def _ctx():
        yield db
    return _ctx


from services.github import GitHubAPIError
from services.scheduler import (
    get_scheduler,
    fetch_all_repos_job,
    check_alerts_job,
    fetch_context_signals_job,
    trigger_fetch_now,
    cleanup_old_snapshots,
    backup_job,
    _track_repo_failure,
    FAILURE_ALERT_THRESHOLD,
)


class TestGetScheduler:
    """Tests for get_scheduler function."""

    def test_returns_singleton(self):
        """Test that scheduler is a singleton."""
        import services.scheduler as scheduler_module

        # 存還原全域 singleton，且 jobstore 指向 in-memory 避免碰真實 DB 檔
        original = scheduler_module._scheduler
        try:
            scheduler_module._scheduler = None
            with patch('services.scheduler.DATABASE_URL', 'sqlite:///:memory:'):
                s1 = get_scheduler()
                s2 = get_scheduler()
                assert s1 is s2
        finally:
            scheduler_module._scheduler = original


@pytest.fixture(autouse=True)
def _isolate_failure_counts():
    """模組級隔離：失敗計數與健康狀態這兩個模組全域不得跨測試洩漏。"""
    import services.scheduler as scheduler_module

    original_counts = dict(scheduler_module._repo_failure_counts)
    original_health = dict(scheduler_module._scheduler_health)
    scheduler_module._repo_failure_counts.clear()
    yield
    scheduler_module._repo_failure_counts.clear()
    scheduler_module._repo_failure_counts.update(original_counts)
    with scheduler_module._health_lock:
        scheduler_module._scheduler_health.clear()
        scheduler_module._scheduler_health.update(original_health)


class TestFetchAllReposJob:
    """Tests for fetch_all_repos_job function."""

    @pytest.mark.asyncio
    async def test_empty_watchlist(self, test_db):
        """Test with empty watchlist."""
        with patch('services.scheduler.get_db_session', new=_mock_db_ctx(test_db)):
            # Should complete without error
            await fetch_all_repos_job()

    @pytest.mark.asyncio
    async def test_fetches_repos(self, test_db, mock_repo):
        """Test fetches repos from watchlist."""
        with patch('services.scheduler.get_db_session', new=_mock_db_ctx(test_db)), \
             patch('services.scheduler.fetch_repo_data', new_callable=AsyncMock) as mock_fetch, \
             patch('services.scheduler.update_repo_from_github') as mock_update:

            mock_fetch.return_value = {
                "stargazers_count": 1000,
                "forks_count": 100,
                "subscribers_count": 50,
                "open_issues_count": 10,
                "description": "Test",
                "language": "Python",
            }

            await fetch_all_repos_job()

            mock_fetch.assert_called_once_with(mock_repo.owner, mock_repo.name)
            mock_update.assert_called_once()
            # Verify update was called with the correct repo, github data, and db session
            call_args = mock_update.call_args
            assert call_args[0][0] == mock_repo
            assert call_args[0][1] == mock_fetch.return_value
            assert call_args[0][2] is test_db

    @pytest.mark.asyncio
    async def test_one_failure_does_not_stop_the_rest(self, test_db, mock_multiple_repos):
        """核心語意：3 個 repo 中間一個炸，其餘照抓、簿記正確、健康狀態記到失敗。"""
        import services.scheduler as scheduler_module
        from services.github import GitHubAPIError
        from services.scheduler import get_scheduler_health

        failing_repo = mock_multiple_repos[1]

        async def fetch_side_effect(owner, name):
            if owner == failing_repo.owner and name == failing_repo.name:
                raise GitHubAPIError("boom")
            return {"stargazers_count": 1, "forks_count": 1, "open_issues_count": 0}

        with patch('services.scheduler.get_db_session', new=_mock_db_ctx(test_db)), \
             patch('services.scheduler.fetch_repo_data', new=AsyncMock(side_effect=fetch_side_effect)), \
             patch('services.scheduler.update_repo_from_github') as mock_update:
            await fetch_all_repos_job()

        # 其餘兩個 repo 照樣被更新
        updated_ids = {call.args[0].id for call in mock_update.call_args_list}
        assert updated_ids == {mock_multiple_repos[0].id, mock_multiple_repos[2].id}
        # 只有失敗的那個累加計數
        assert scheduler_module._repo_failure_counts == {failing_repo.id: 1}
        # 健康狀態記錄到失敗
        health = get_scheduler_health()
        assert health["last_fetch_error"] == "1 repos 抓取失敗"
        assert health["last_fetch_failure"] is not None

    @pytest.mark.asyncio
    async def test_fetches_repos_concurrently_not_serially(self, test_db, mock_multiple_repos):
        """抓取必須併發：序列化時整輪耗時 = repo 數 × 單次往返，會把 event loop 佔住。

        量的是「同時在飛的抓取數」而不是總耗時。用牆鐘時間當代理指標分不出
        「序列執行」與「機器很慢」——CI 上實測拿到 341ms，序列與併發加負載都解釋
        得通，於是那個門檻只是在賭 runner 的速度（實測本機併發 100ms、序列 300ms，
        而 CI 兩者都可能落在門檻外）。改量並行度後與機器速度無關。
        """
        import asyncio

        in_flight = 0
        max_in_flight = 0

        async def tracked_fetch(owner, name):
            nonlocal in_flight, max_in_flight
            in_flight += 1
            max_in_flight = max(max_in_flight, in_flight)
            # 讓出控制權，其他抓取才有機會開始——沒有這個 await，即使是併發實作
            # 也會因為沒有暫停點而一個接一個跑完
            await asyncio.sleep(0.01)
            in_flight -= 1
            return {"stargazers_count": 1, "forks_count": 1, "open_issues_count": 0}

        with patch('services.scheduler.get_db_session', new=_mock_db_ctx(test_db)), \
             patch('services.scheduler.fetch_repo_data', new=AsyncMock(side_effect=tracked_fetch)), \
             patch('services.scheduler.update_repo_from_github'):
            await fetch_all_repos_job()

        assert max_in_flight > 1, (
            f"同時最多只有 {max_in_flight} 個抓取在飛，仍是序列抓取")

    @pytest.mark.asyncio
    async def test_skip_recent_minutes_skips_freshly_fetched(self, test_db, mock_multiple_repos):
        """近期已抓取的 repo 必須被跳過（skip_recent_minutes 子查詢）。"""
        from datetime import timedelta
        from db.models import RepoSnapshot
        from utils.time import utc_now

        fresh, stale = mock_multiple_repos[0], mock_multiple_repos[1]
        test_db.add_all([
            RepoSnapshot(repo_id=fresh.id, snapshot_date=utc_now().date(),
                         fetched_at=utc_now() - timedelta(minutes=5), stars=1),
            RepoSnapshot(repo_id=stale.id, snapshot_date=utc_now().date(),
                         fetched_at=utc_now() - timedelta(hours=2), stars=1),
        ])
        test_db.commit()

        with patch('services.scheduler.get_db_session', new=_mock_db_ctx(test_db)), \
             patch('services.scheduler.fetch_repo_data', new_callable=AsyncMock) as mock_fetch, \
             patch('services.scheduler.update_repo_from_github'):
            mock_fetch.return_value = {"stargazers_count": 1}
            await fetch_all_repos_job(skip_recent_minutes=30)

        fetched = {(call.args[0], call.args[1]) for call in mock_fetch.call_args_list}
        assert (fresh.owner, fresh.name) not in fetched     # 5 分鐘前抓過 → 跳過
        assert (stale.owner, stale.name) in fetched          # 2 小時前 → 要抓
        assert (mock_multiple_repos[2].owner, mock_multiple_repos[2].name) in fetched  # 無快照 → 要抓

    @pytest.mark.asyncio
    async def test_handles_fetch_error(self, test_db, mock_repo):
        """Test handles errors during fetch."""
        with patch('services.scheduler.get_db_session', new=_mock_db_ctx(test_db)), \
             patch('services.scheduler.fetch_repo_data', new_callable=AsyncMock) as mock_fetch:

            mock_fetch.return_value = None  # Simulate fetch failure

            # Should not raise, just log
            await fetch_all_repos_job()

    @pytest.mark.asyncio
    async def test_handles_github_exception(self, test_db, mock_repo):
        """Test handles GitHub API exceptions gracefully (per-repo)."""
        with patch('services.scheduler.get_db_session', new=_mock_db_ctx(test_db)), \
             patch('services.scheduler.fetch_repo_data', new_callable=AsyncMock) as mock_fetch:

            mock_fetch.side_effect = GitHubAPIError("API Error")

            # Should not raise, just log and continue to next repo
            await fetch_all_repos_job()

    @pytest.mark.asyncio
    async def test_handles_unexpected_exception(self, test_db, mock_repo):
        """Test handles unexpected exceptions gracefully (per-repo)."""
        with patch('services.scheduler.get_db_session', new=_mock_db_ctx(test_db)), \
             patch('services.scheduler.fetch_repo_data', new_callable=AsyncMock) as mock_fetch:

            mock_fetch.side_effect = ValueError("Unexpected error")

            # Should not raise, just log and continue to next repo
            await fetch_all_repos_job()


class TestCheckAlertsJob:
    """Tests for check_alerts_job function."""

    def test_checks_alerts(self, test_db):
        """Test calls check_all_alerts with a valid DB session."""
        with patch('services.scheduler.get_db_session', new=_mock_db_ctx(test_db)), \
             patch('services.alerts.check_all_alerts') as mock_check:

            mock_check.return_value = []
            check_alerts_job()

            mock_check.assert_called_once()
            # Verify a DB session was passed as the first argument
            call_args = mock_check.call_args
            assert call_args[0][0] is test_db

    def test_handles_triggered_alerts(self, test_db):
        """Test processes non-empty triggered alerts without raising."""
        with patch('services.scheduler.get_db_session', new=_mock_db_ctx(test_db)), \
             patch('services.alerts.check_all_alerts') as mock_check:

            mock_check.return_value = [MagicMock(), MagicMock()]
            # Should complete without raising even with triggered alerts
            check_alerts_job()

            mock_check.assert_called_once()
            # Verify the session arg was passed
            call_args = mock_check.call_args
            assert call_args[0][0] is test_db

    def test_handles_exception(self, test_db):
        """Test handles exception gracefully."""
        with patch('services.scheduler.get_db_session', new=_mock_db_ctx(test_db)), \
             patch('services.alerts.check_all_alerts') as mock_check:

            mock_check.side_effect = Exception("DB Error")
            check_alerts_job()  # Should not raise


class TestFetchContextSignalsJob:
    """Tests for fetch_context_signals_job function."""

    @pytest.mark.asyncio
    async def test_fetches_context_signals(self, test_db):
        """Test fetches context signals."""
        with patch('services.scheduler.get_db_session', new=_mock_db_ctx(test_db)), \
             patch('services.scheduler.fetch_all_context_signals', new_callable=AsyncMock) as mock_fetch:

            mock_fetch.return_value = {
                "new_hn_signals": 5,
                "errors": 0,
            }

            await fetch_context_signals_job()

            mock_fetch.assert_called_once()

    @pytest.mark.asyncio
    async def test_handles_exception(self, test_db):
        """Test handles exception gracefully."""
        with patch('services.scheduler.get_db_session', new=_mock_db_ctx(test_db)), \
             patch('services.scheduler.fetch_all_context_signals', new_callable=AsyncMock) as mock_fetch:

            mock_fetch.side_effect = Exception("Network Error")

            await fetch_context_signals_job()  # Should not raise


class TestTriggerFetchNow:
    """Tests for trigger_fetch_now function."""

    @pytest.mark.asyncio
    async def test_triggers_immediate_fetch(self):
        """Test triggers immediate fetch."""
        with patch('services.scheduler.fetch_all_repos_job', new_callable=AsyncMock) as mock_fetch, \
             patch('services.scheduler.check_alerts_job') as mock_alerts, \
             patch('services.scheduler.fetch_context_signals_job', new_callable=AsyncMock) as mock_ctx:

            await trigger_fetch_now()

            mock_fetch.assert_called_once()
            mock_alerts.assert_called_once()
            mock_ctx.assert_called_once()


class TestTrackRepoFailure:
    """Tests for _track_repo_failure function.（計數隔離由模組級 autouse fixture 保證）"""

    def test_increments_count(self):
        """Test failure count increments."""
        import services.scheduler as scheduler_module
        _track_repo_failure(1, "owner/repo", "API error")
        assert scheduler_module._repo_failure_counts[1] == 1

    def test_warns_at_threshold(self):
        """Test logs warning at exactly FAILURE_ALERT_THRESHOLD."""
        import services.scheduler as scheduler_module
        # Reach threshold - 1
        scheduler_module._repo_failure_counts[1] = FAILURE_ALERT_THRESHOLD - 1

        with patch('services.scheduler.logger') as mock_logger:
            _track_repo_failure(1, "owner/repo", "API error")
            mock_logger.warning.assert_called_once()
            assert "連續失敗" in mock_logger.warning.call_args[0][0]

    def test_warns_at_multiples_of_threshold(self):
        """Test logs warning at multiples of threshold (e.g., 10, 15)."""
        import services.scheduler as scheduler_module
        scheduler_module._repo_failure_counts[1] = FAILURE_ALERT_THRESHOLD * 2 - 1

        with patch('services.scheduler.logger') as mock_logger:
            _track_repo_failure(1, "owner/repo", "Still failing")
            mock_logger.warning.assert_called_once()
            assert "持續失敗" in mock_logger.warning.call_args[0][0]

    def test_no_warn_below_threshold(self):
        """Test no warning below threshold."""
        with patch('services.scheduler.logger') as mock_logger:
            _track_repo_failure(1, "owner/repo", "API error")
            mock_logger.warning.assert_not_called()

    def test_truncates_long_reason(self):
        """Test reason is truncated to 200 chars in log."""
        import services.scheduler as scheduler_module
        scheduler_module._repo_failure_counts[1] = FAILURE_ALERT_THRESHOLD - 1

        long_reason = "x" * 500
        with patch('services.scheduler.logger') as mock_logger:
            _track_repo_failure(1, "owner/repo", long_reason)
            logged_msg = mock_logger.warning.call_args[0][0]
            # Reason in log should be truncated to 200 chars
            assert "x" * 200 in logged_msg
            assert "x" * 201 not in logged_msg


class TestCleanupOldSnapshots:
    """Tests for cleanup_old_snapshots function."""

    def test_cleanup_no_old_snapshots(self, test_db):
        """Test cleanup when no snapshots exceed retention period."""
        with patch('services.scheduler.get_db_session', new=_mock_db_ctx(test_db)):
            deleted = cleanup_old_snapshots(retention_days=90)
            assert deleted == 0

    def test_cleanup_with_old_snapshots(self, test_db, mock_repo):
        """Test cleanup removes old snapshots but keeps latest per repo."""
        from db.models import RepoSnapshot
        from datetime import datetime, timedelta, timezone

        now = datetime.now(timezone.utc)

        # Create old snapshot (> 90 days)
        old_snapshot = RepoSnapshot(
            repo_id=mock_repo.id,
            snapshot_date=(now - timedelta(days=100)).date(),
            fetched_at=now - timedelta(days=100),
            stars=100,
            forks=10,
            watchers=5,
            open_issues=1,
        )
        test_db.add(old_snapshot)

        # Create recent snapshot (should NOT be deleted, it's the latest)
        recent_snapshot = RepoSnapshot(
            repo_id=mock_repo.id,
            snapshot_date=now.date(),
            fetched_at=now,
            stars=200,
            forks=20,
            watchers=10,
            open_issues=2,
        )
        test_db.add(recent_snapshot)
        test_db.commit()

        with patch('services.scheduler.get_db_session', new=_mock_db_ctx(test_db)):
            deleted = cleanup_old_snapshots(retention_days=90)
            assert deleted == 1

        # Verify the recent snapshot survived, not the old one
        remaining = test_db.query(RepoSnapshot).filter(
            RepoSnapshot.repo_id == mock_repo.id
        ).all()
        assert len(remaining) == 1
        assert remaining[0].stars == 200  # recent snapshot

    def test_cleanup_db_error(self, test_db):
        """Test cleanup handles DB error gracefully."""
        from sqlalchemy.exc import SQLAlchemyError

        with patch('services.scheduler.get_db_session', new=_mock_db_ctx(test_db)), \
             patch.object(test_db, 'query', side_effect=SQLAlchemyError("DB error")):
            deleted = cleanup_old_snapshots()
            assert deleted == 0


class TestBackupJob:
    """Tests for backup_job function."""

    def test_skips_memory_database(self):
        """Test skips backup for :memory: database."""
        with patch('services.scheduler.DATABASE_URL', 'sqlite:///:memory:'), \
             patch('services.scheduler.backup_database') as mock_backup:
            backup_job()

            mock_backup.assert_not_called()

    def test_skips_test_environment(self):
        """Test skips backup when ENV=test."""
        with patch('services.scheduler.DATABASE_URL', 'sqlite:///test.db'), \
             patch.dict('os.environ', {'ENV': 'test'}), \
             patch('services.scheduler.backup_database') as mock_backup:
            backup_job()

            mock_backup.assert_not_called()

    def test_backup_success(self):
        """Test successful backup."""
        with patch('services.scheduler.DATABASE_URL', 'sqlite:///app.db'), \
             patch.dict('os.environ', {}, clear=True), \
             patch('services.scheduler.backup_database') as mock_backup:
            mock_backup.return_value = "/backups/app_20240101.db"

            backup_job()

            mock_backup.assert_called_once_with("app.db", retention_days=7)

    def test_backup_returns_none(self):
        """Test handles backup failure (returns None)."""
        with patch('services.scheduler.DATABASE_URL', 'sqlite:///app.db'), \
             patch.dict('os.environ', {}, clear=True), \
             patch('services.scheduler.backup_database') as mock_backup:
            mock_backup.return_value = None

            backup_job()  # 失敗不得外洩例外（APScheduler job 不該炸）

            mock_backup.assert_called_once()

    def test_backup_os_error(self):
        """Test handles OSError during backup."""
        with patch('services.scheduler.DATABASE_URL', 'sqlite:///app.db'), \
             patch.dict('os.environ', {}, clear=True), \
             patch('services.scheduler.backup_database') as mock_backup:
            mock_backup.side_effect = OSError("Disk full")

            backup_job()  # 失敗不得外洩例外（APScheduler job 不該炸）

            mock_backup.assert_called_once()


class TestCheckAlertsJobImportError:
    """Tests for check_alerts_job edge cases."""

    def test_handles_import_error(self, test_db, caplog):
        """Test handles ImportError when alerts service unavailable."""
        import logging

        # check_alerts_job uses lazy import (from services.alerts import check_all_alerts),
        # so patching sys.modules with None correctly triggers ImportError
        with caplog.at_level(logging.DEBUG), \
             patch('services.scheduler.get_db_session', new=_mock_db_ctx(test_db)), \
             patch.dict('sys.modules', {'services.alerts': None}):
            check_alerts_job()  # 不得外洩例外

        assert any("警報服務尚未可用" in r.getMessage() for r in caplog.records)

    def test_handles_sqlalchemy_error(self, test_db):
        """Test handles SQLAlchemyError during alert check."""
        from sqlalchemy.exc import SQLAlchemyError

        with patch('services.scheduler.get_db_session', new=_mock_db_ctx(test_db)), \
             patch('services.alerts.check_all_alerts') as mock_check:
            mock_check.side_effect = SQLAlchemyError("Connection lost")

            check_alerts_job()  # Should not raise


class TestFetchContextSignalsJobCleanup:
    """Tests for fetch_context_signals_job cleanup path."""

    @pytest.mark.asyncio
    async def test_runs_cleanup_after_fetch(self, test_db):
        """Test runs cleanup_old_context_signals after successful fetch."""
        with patch('services.scheduler.get_db_session', new=_mock_db_ctx(test_db)), \
             patch('services.scheduler.fetch_all_context_signals', new_callable=AsyncMock) as mock_fetch, \
             patch('services.context_fetcher.cleanup_old_context_signals') as mock_cleanup:

            # 與 fetch_all_context_signals 的真實回傳形狀一致
            mock_fetch.return_value = {"repos_processed": 2, "new_hn_signals": 3, "errors": 0}
            mock_cleanup.return_value = {"deleted_by_age": 5, "deleted_by_limit": 0}

            await fetch_context_signals_job()

            mock_cleanup.assert_called_once()

    @pytest.mark.asyncio
    async def test_handles_sqlalchemy_error(self, test_db):
        """Test handles SQLAlchemyError during context signal fetch."""
        from sqlalchemy.exc import SQLAlchemyError

        with patch('services.scheduler.get_db_session', new=_mock_db_ctx(test_db)), \
             patch('services.scheduler.fetch_all_context_signals', new_callable=AsyncMock) as mock_fetch:

            mock_fetch.side_effect = SQLAlchemyError("DB error")

            await fetch_context_signals_job()  # Should not raise


class TestFeedJob:
    """每日 feed 產生任務。"""

    @pytest.mark.asyncio
    async def test_generate_feed_job_invokes_pipeline(self, test_db):
        """Test generate_feed_job invokes the feed generation pipeline."""
        with patch('services.scheduler.get_db_session', new=_mock_db_ctx(test_db)), \
             patch('services.scheduler.get_github_service') as mock_get_github, \
             patch('services.scheduler.generate_feed',
                   new=AsyncMock(return_value=5)) as mock_gen:
            from services.scheduler import generate_feed_job
            await generate_feed_job()
        mock_gen.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_generate_feed_job_keys_by_local_date_not_utc(self, test_db):
        """generate_feed_job 必須用 local_today() 當 feed_date，而非 utc_now().date()。

        Cron 觸發時區是本機時區（AsyncIOScheduler 預設），若 feed_date 用
        UTC 日期，會在時區偏移的時段把批次寫進「錯的一天」（見 finding: cron
        本地時區 x feed_date UTC 日期錯配）。
        """
        from datetime import date
        sentinel_local_date = date(2099, 1, 1)
        with patch('services.scheduler.get_db_session', new=_mock_db_ctx(test_db)), \
             patch('services.scheduler.get_github_service'), \
             patch('services.scheduler.local_today', return_value=sentinel_local_date), \
             patch('services.scheduler.generate_feed',
                   new=AsyncMock(return_value=1)) as mock_gen:
            from services.scheduler import generate_feed_job
            await generate_feed_job()
        _db_arg, _github_arg, feed_date_arg = mock_gen.call_args.args
        assert feed_date_arg == sentinel_local_date

    def test_feed_job_registered(self):
        """Test _register_feed_job registers a "daily_feed" cron job."""
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from services.scheduler import _register_feed_job
        scheduler = AsyncIOScheduler()
        _register_feed_job(scheduler)
        job = scheduler.get_job("daily_feed")
        assert job is not None


class TestEarlySignalDetectionRunsAfterFetch:
    """
    早期訊號偵測必須真的被呼叫。

    2026-08-23 發現 run_detection 沒有任何呼叫端——不在排程的任何一個任務裡、
    也不在任何路由裡。early_signals 表從產品上線起都是 0 筆，儀表板的訊號
    區塊因此永遠不出現，而設定頁那四個門檻調了完全沒作用。測試會綠，
    因為測試直接呼叫 run_detection。

    掛在 fetch_all_repos_job 之後而不是自己一個排程任務，理由是：
    偵測吃的正是抓取剛寫進去的資料；而且這個 job 會被 main.py 的
    trigger_fetch_now() 在啟動時叫到，IntervalTrigger 不會。
    """

    @pytest.mark.asyncio
    async def test_fetch_job_triggers_detection(self, monkeypatch):
        from services import scheduler as sched
        import services.anomaly_detector as det

        calls: list[str] = []

        def fake_run_detection(db):
            calls.append("ran")
            return {"repos_scanned": 0, "signals_detected": 0, "by_type": {}}

        monkeypatch.setattr(det, "run_detection", fake_run_detection)
        monkeypatch.setattr(sched, "_build_need_fetch_query",
                            lambda db, m, log, jid: (_FakeQuery(), 0, None))

        await sched._fetch_all_repos_inner(skip_recent_minutes=0)

        assert calls == ["ran"], "抓取完成後沒有觸發早期訊號偵測"

    @pytest.mark.asyncio
    async def test_detection_failure_does_not_fail_the_fetch(self, monkeypatch):
        """偵測炸掉不該讓整輪抓取算失敗——抓到的資料已經寫進去了。"""
        from services import scheduler as sched
        import services.anomaly_detector as det

        def boom(db):
            raise RuntimeError("偵測爆炸")

        monkeypatch.setattr(det, "run_detection", boom)
        monkeypatch.setattr(sched, "_build_need_fetch_query",
                            lambda db, m, log, jid: (_FakeQuery(), 0, None))

        # 不該拋出
        await sched._fetch_all_repos_inner(skip_recent_minutes=0)


class _FakeQuery:
    def all(self):
        return []
