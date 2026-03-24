"""
Tests for services/context_fetcher.py - Context signal fetching service.
Simplified to only test HN signals after product simplification.
"""

from datetime import datetime, timezone
from unittest.mock import patch, AsyncMock, MagicMock

import pytest
from sqlalchemy.exc import SQLAlchemyError

from services.context_fetcher import (
    fetch_context_signals_for_repo,
    fetch_all_context_signals,
)
# Import module for accessing protected members in tests
from services import context_fetcher as context_fetcher_module


def create_mock_hn_story(object_id: str, title: str = "Test HN Story") -> MagicMock:
    """Create a mock HN story for testing."""
    story = MagicMock()
    story.object_id = object_id
    story.title = title
    story.url = f"https://example.com/{object_id}"
    story.points = 100
    story.num_comments = 50
    story.author = "testuser"
    story.created_at = datetime.now(timezone.utc)
    return story


class TestGetExistingSignalMap:
    """Tests for _get_existing_signal_map function."""

    def test_empty_external_ids(self, test_db, mock_repo):
        """Test with empty external_ids returns empty dict."""
        result = context_fetcher_module._get_existing_signal_map(
            mock_repo.id, "hacker_news", [], test_db
        )
        assert result == {}

    def test_no_existing_signals(self, test_db, mock_repo):
        """Test with no existing signals returns empty dict."""
        result = context_fetcher_module._get_existing_signal_map(
            mock_repo.id, "hacker_news", ["abc123"], test_db
        )
        assert result == {}


class TestStoreHnSignals:
    """Tests for _store_hn_signals function."""

    def test_stores_new_signals(self, test_db, mock_repo):
        """Test storing new HN signals."""
        from db.models import ContextSignal

        stories = [create_mock_hn_story("hn1"), create_mock_hn_story("hn2")]
        count = context_fetcher_module._store_hn_signals(mock_repo.id, stories, test_db)  # type: ignore[arg-type]

        assert count == 2
        # Verify records were added to the session (flush to materialize)
        test_db.flush()
        stored = test_db.query(ContextSignal).filter(
            ContextSignal.repo_id == mock_repo.id
        ).all()
        assert len(stored) == 2
        stored_ids = {s.external_id for s in stored}
        assert stored_ids == {"hn1", "hn2"}

    def test_empty_stories(self, test_db, mock_repo):
        """Test with empty stories list."""
        count = context_fetcher_module._store_hn_signals(mock_repo.id, [], test_db)
        assert count == 0


class TestFetchContextSignalsForRepo:
    """Tests for fetch_context_signals_for_repo function."""

    @pytest.mark.asyncio
    async def test_fetches_hn_signals(self, test_db, mock_repo):
        """Test fetching HN signals."""
        with patch(
            'services.context_fetcher.fetch_hn_mentions', new_callable=AsyncMock
        ) as mock_hn:
            mock_hn.return_value = [create_mock_hn_story("hn1")]

            hn_count = await fetch_context_signals_for_repo(mock_repo, test_db)

            assert hn_count == 1

    @pytest.mark.asyncio
    async def test_handles_db_errors(self, test_db, mock_repo):
        """Test handling SQLAlchemy errors from signal storage."""
        with patch(
            'services.context_fetcher.fetch_hn_mentions', new_callable=AsyncMock
        ) as mock_hn, patch(
            'services.context_fetcher._store_hn_signals',
            side_effect=SQLAlchemyError("DB write error"),
        ):
            mock_hn.return_value = [create_mock_hn_story("hn1")]

            hn_count = await fetch_context_signals_for_repo(mock_repo, test_db)

            # SQLAlchemyError should result in 0 count, not crash
            assert hn_count == 0


class TestFetchAllContextSignals:
    """Tests for fetch_all_context_signals function."""

    @pytest.mark.asyncio
    async def test_processes_all_repos(self, test_db, mock_multiple_repos):
        """Test processing all repos in watchlist."""
        with patch(
            'services.context_fetcher.fetch_hn_mentions', new_callable=AsyncMock
        ) as mock_hn:
            mock_hn.return_value = []

            result = await fetch_all_context_signals(test_db)

            assert result["repos_processed"] == 3
            assert result["errors"] == 0

    @pytest.mark.asyncio
    async def test_handles_db_errors_gracefully(self, test_db, mock_repo):
        """Test that DB errors don't crash the entire batch process."""
        with patch(
            'services.context_fetcher.fetch_context_signals_for_repo',
            new_callable=AsyncMock,
        ) as mock_fetch:
            mock_fetch.side_effect = SQLAlchemyError("DB commit error")

            result = await fetch_all_context_signals(test_db)

            assert result["errors"] == 1

    @pytest.mark.asyncio
    async def test_handles_unexpected_errors_gracefully(self, test_db, mock_repo):
        """Test that unexpected errors don't crash the entire batch process."""
        with patch(
            'services.context_fetcher.fetch_context_signals_for_repo',
            new_callable=AsyncMock,
        ) as mock_fetch:
            mock_fetch.side_effect = RuntimeError("Unexpected failure")

            result = await fetch_all_context_signals(test_db)

            assert result["errors"] == 1
