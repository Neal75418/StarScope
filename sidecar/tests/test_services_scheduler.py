"""
Tests for services/scheduler.py - Background scheduler service.
"""

from contextlib import contextmanager

import pytest
from unittest.mock import MagicMock, patch, AsyncMock


def _mock_db_ctx(db):
    """Create a context manager that yields the given db session."""
    @contextmanager
    def _ctx():
        yield db
    return _ctx()


from services.github import GitHubAPIError
from services.scheduler import (
    get_scheduler,
    fetch_all_repos_job,
    check_alerts_job,
    fetch_context_signals_job,
    trigger_fetch_now,
    get_scheduler_status,
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


class TestGetSchedulerStatus:
    """Tests for get_scheduler_status function."""

    def test_returns_status_dict(self):
        """Test returns status dictionary."""
        import services.scheduler as scheduler_module
        scheduler_module._scheduler = None

        status = get_scheduler_status()

        assert "running" in status
        assert "jobs" in status
        assert isinstance(status["jobs"], list)


class TestFetchAllReposJob:
    """Tests for fetch_all_repos_job function."""

    @pytest.mark.asyncio
    async def test_empty_watchlist(self, test_db):
        """Test with empty watchlist."""
        with patch('services.scheduler.get_db_session', return_value=_mock_db_ctx(test_db)):
            # Should complete without error
            await fetch_all_repos_job()

    @pytest.mark.asyncio
    async def test_fetches_repos(self, test_db, mock_repo):
        """Test fetches repos from watchlist."""
        with patch('services.scheduler.get_db_session', return_value=_mock_db_ctx(test_db)), \
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
        with patch('services.scheduler.get_db_session', return_value=_mock_db_ctx(test_db)), \
             patch('services.scheduler.fetch_repo_data', new_callable=AsyncMock) as mock_fetch:

            mock_fetch.return_value = None  # Simulate fetch failure

            # Should not raise, just log
            await fetch_all_repos_job()

    @pytest.mark.asyncio
    async def test_handles_github_exception(self, test_db, mock_repo):
        """Test handles GitHub API exceptions gracefully (per-repo)."""
        with patch('services.scheduler.get_db_session', return_value=_mock_db_ctx(test_db)), \
             patch('services.scheduler.fetch_repo_data', new_callable=AsyncMock) as mock_fetch:

            mock_fetch.side_effect = GitHubAPIError("API Error")

            # Should not raise, just log and continue to next repo
            await fetch_all_repos_job()

    @pytest.mark.asyncio
    async def test_handles_unexpected_exception(self, test_db, mock_repo):
        """Test handles unexpected exceptions gracefully (per-repo)."""
        with patch('services.scheduler.get_db_session', return_value=_mock_db_ctx(test_db)), \
             patch('services.scheduler.fetch_repo_data', new_callable=AsyncMock) as mock_fetch:

            mock_fetch.side_effect = ValueError("Unexpected error")

            # Should not raise, just log and continue to next repo
            await fetch_all_repos_job()


class TestCheckAlertsJob:
    """Tests for check_alerts_job function."""

    def test_checks_alerts(self, test_db):
        """Test calls check_all_alerts."""
        with patch('services.scheduler.get_db_session', return_value=_mock_db_ctx(test_db)), \
             patch('services.alerts.check_all_alerts') as mock_check:

            mock_check.return_value = []
            check_alerts_job()

            mock_check.assert_called_once()

    def test_handles_triggered_alerts(self, test_db):
        """Test handles triggered alerts."""
        with patch('services.scheduler.get_db_session', return_value=_mock_db_ctx(test_db)), \
             patch('services.alerts.check_all_alerts') as mock_check:

            mock_check.return_value = [MagicMock(), MagicMock()]
            check_alerts_job()

            mock_check.assert_called_once()

    def test_handles_exception(self, test_db):
        """Test handles exception gracefully."""
        with patch('services.scheduler.get_db_session', return_value=_mock_db_ctx(test_db)), \
             patch('services.alerts.check_all_alerts') as mock_check:

            mock_check.side_effect = Exception("DB Error")
            check_alerts_job()  # Should not raise


class TestFetchContextSignalsJob:
    """Tests for fetch_context_signals_job function."""

    @pytest.mark.asyncio
    async def test_fetches_context_signals(self, test_db):
        """Test fetches context signals."""
        with patch('services.scheduler.get_db_session', return_value=_mock_db_ctx(test_db)), \
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
        with patch('services.scheduler.get_db_session', return_value=_mock_db_ctx(test_db)), \
             patch('services.scheduler.fetch_all_context_signals', new_callable=AsyncMock) as mock_fetch:

            mock_fetch.side_effect = Exception("Network Error")

            await fetch_context_signals_job()  # Should not raise


class TestTriggerFetchNow:
    """Tests for trigger_fetch_now function."""

    @pytest.mark.asyncio
    async def test_triggers_immediate_fetch(self):
        """Test triggers immediate fetch."""
        with patch('services.scheduler.fetch_all_repos_job', new_callable=AsyncMock) as mock_fetch, \
             patch('services.scheduler.check_alerts_job') as mock_alerts:

            await trigger_fetch_now()

            mock_fetch.assert_called_once()
            mock_alerts.assert_called_once()
