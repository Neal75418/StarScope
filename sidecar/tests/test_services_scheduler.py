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

    def test_returns_scheduler(self):
        """Test that scheduler is returned."""
        # Reset global
        import services.scheduler as scheduler_module
        scheduler_module._scheduler = None

        scheduler = get_scheduler()
        assert scheduler is not None

    def test_returns_singleton(self):
        """Test that scheduler is a singleton."""
        import services.scheduler as scheduler_module
        scheduler_module._scheduler = None

        s1 = get_scheduler()
        s2 = get_scheduler()
        assert s1 is s2


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

            mock_fetch.assert_called_once()
            mock_update.assert_called_once()

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
        """Test calls check_all_alerts."""
        with patch('services.scheduler.get_db_session', new=_mock_db_ctx(test_db)), \
             patch('services.alerts.check_all_alerts') as mock_check:

            mock_check.return_value = []
            check_alerts_job()

            mock_check.assert_called_once()

    def test_handles_triggered_alerts(self, test_db):
        """Test handles triggered alerts."""
        with patch('services.scheduler.get_db_session', new=_mock_db_ctx(test_db)), \
             patch('services.alerts.check_all_alerts') as mock_check:

            mock_check.return_value = [MagicMock(), MagicMock()]
            check_alerts_job()

            mock_check.assert_called_once()

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
    """Tests for _track_repo_failure function."""

    @pytest.fixture(autouse=True)
    def reset_failure_counts(self):
        """Reset failure counts before each test and restore after."""
        import services.scheduler as scheduler_module
        original = dict(scheduler_module._repo_failure_counts)
        scheduler_module._repo_failure_counts.clear()
        yield
        scheduler_module._repo_failure_counts.clear()
        scheduler_module._repo_failure_counts.update(original)

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
        with patch('services.scheduler.DATABASE_URL', 'sqlite:///:memory:'):
            backup_job()  # Should return without calling backup_database

    def test_skips_test_environment(self):
        """Test skips backup when ENV=test."""
        with patch('services.scheduler.DATABASE_URL', 'sqlite:///test.db'), \
             patch.dict('os.environ', {'ENV': 'test'}):
            backup_job()  # Should return without calling backup_database

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

            backup_job()  # Should not raise

    def test_backup_os_error(self):
        """Test handles OSError during backup."""
        with patch('services.scheduler.DATABASE_URL', 'sqlite:///app.db'), \
             patch.dict('os.environ', {}, clear=True), \
             patch('services.scheduler.backup_database') as mock_backup:
            mock_backup.side_effect = OSError("Disk full")

            backup_job()  # Should not raise


class TestCheckAlertsJobImportError:
    """Tests for check_alerts_job edge cases."""

    def test_handles_import_error(self):
        """Test handles ImportError when alerts service unavailable."""
        import builtins
        original_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name == 'services.alerts':
                raise ImportError("No module named 'services.alerts'")
            return original_import(name, *args, **kwargs)

        with patch('builtins.__import__', side_effect=mock_import):
            check_alerts_job()  # Should not raise

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

            mock_fetch.return_value = {"new_hn_signals": 3, "errors": 0}
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
