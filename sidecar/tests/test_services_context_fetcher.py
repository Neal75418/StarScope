"""
Tests for services/context_fetcher.py - Context signal fetching service.
"""

import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch, AsyncMock
from typing import List

from services.context_fetcher import (
    _get_existing_signal_map,
    _update_existing_signal,
    _store_hn_signals,
    _store_reddit_signals,
    _store_release_signals,
    fetch_context_signals_for_repo,
    fetch_all_context_signals,
)
from services.hacker_news import HNStory
from services.reddit import RedditPost
from services.releases import GitHubRelease


class MockHNStory:
    """Mock HN story for testing."""
    def __init__(self, object_id: str, title: str = "Test HN Story"):
        self.object_id = object_id
        self.title = title
        self.url = f"https://example.com/{object_id}"
        self.points = 100
        self.num_comments = 50
        self.author = "testuser"
        self.created_at = datetime.now(timezone.utc)


class MockRedditPost:
    """Mock Reddit post for testing."""
    def __init__(self, post_id: str, title: str = "Test Reddit Post"):
        self.post_id = post_id
        self.title = title
        self.permalink = f"https://reddit.com/r/programming/{post_id}"
        self.score = 200
        self.num_comments = 75
        self.author = "redditor"
        self.created_at = datetime.now(timezone.utc)


class MockGitHubRelease:
    """Mock GitHub release for testing."""
    def __init__(self, release_id: int, tag_name: str = "v1.0.0"):
        self.release_id = release_id
        self.tag_name = tag_name
        self.name = f"Release {tag_name}"
        self.url = f"https://github.com/owner/repo/releases/{release_id}"
        self.author = "maintainer"
        self.is_draft = False
        self.is_prerelease = False
        self.published_at = datetime.now(timezone.utc)
        self.created_at = datetime.now(timezone.utc)


class TestGetExistingSignalMap:
    """Tests for _get_existing_signal_map function."""

    def test_empty_external_ids(self, test_db, mock_repo):
        """Test with empty external_ids returns empty dict."""
        result = _get_existing_signal_map(mock_repo.id, "hacker_news", [], test_db)
        assert result == {}

    def test_no_existing_signals(self, test_db, mock_repo):
        """Test with no existing signals returns empty dict."""
        result = _get_existing_signal_map(mock_repo.id, "hacker_news", ["abc123"], test_db)
        assert result == {}

class TestStoreHnSignals:
    """Tests for _store_hn_signals function."""

    def test_stores_new_signals(self, test_db, mock_repo):
        """Test storing new HN signals."""
        stories = [MockHNStory("hn1"), MockHNStory("hn2")]
        count = _store_hn_signals(mock_repo.id, stories, test_db)

        assert count == 2

    def test_empty_stories(self, test_db, mock_repo):
        """Test with empty stories list."""
        count = _store_hn_signals(mock_repo.id, [], test_db)
        assert count == 0



class TestStoreRedditSignals:
    """Tests for _store_reddit_signals function."""

    def test_stores_new_signals(self, test_db, mock_repo):
        """Test storing new Reddit signals."""
        posts = [MockRedditPost("r1"), MockRedditPost("r2")]
        count = _store_reddit_signals(mock_repo.id, posts, test_db)

        assert count == 2

    def test_empty_posts(self, test_db, mock_repo):
        """Test with empty posts list."""
        count = _store_reddit_signals(mock_repo.id, [], test_db)
        assert count == 0


class TestStoreReleaseSignals:
    """Tests for _store_release_signals function."""

    def test_stores_new_releases(self, test_db, mock_repo):
        """Test storing new release signals."""
        releases = [MockGitHubRelease(1, "v1.0"), MockGitHubRelease(2, "v2.0")]
        count = _store_release_signals(mock_repo.id, releases, test_db)

        assert count == 2

    def test_filters_draft_releases(self, test_db, mock_repo):
        """Test that draft releases are filtered out."""
        release = MockGitHubRelease(1, "v1.0")
        release.is_draft = True
        releases = [release]

        count = _store_release_signals(mock_repo.id, releases, test_db)
        assert count == 0

    def test_empty_releases(self, test_db, mock_repo):
        """Test with empty releases list."""
        count = _store_release_signals(mock_repo.id, [], test_db)
        assert count == 0


class TestFetchContextSignalsForRepo:
    """Tests for fetch_context_signals_for_repo function."""

    @pytest.mark.asyncio
    async def test_fetches_all_sources(self, test_db, mock_repo):
        """Test fetching from all sources in parallel."""
        with patch('services.context_fetcher.fetch_hn_mentions', new_callable=AsyncMock) as mock_hn, \
             patch('services.context_fetcher.fetch_reddit_mentions', new_callable=AsyncMock) as mock_reddit, \
             patch('services.context_fetcher.fetch_releases', new_callable=AsyncMock) as mock_releases:

            mock_hn.return_value = [MockHNStory("hn1")]
            mock_reddit.return_value = [MockRedditPost("r1")]
            mock_releases.return_value = [MockGitHubRelease(1)]

            hn_count, reddit_count, release_count = await fetch_context_signals_for_repo(mock_repo, test_db)

            assert hn_count == 1
            assert reddit_count == 1
            assert release_count == 1

    @pytest.mark.asyncio
    async def test_handles_exceptions(self, test_db, mock_repo):
        """Test handling exceptions from fetchers."""
        with patch('services.context_fetcher.fetch_hn_mentions', new_callable=AsyncMock) as mock_hn, \
             patch('services.context_fetcher.fetch_reddit_mentions', new_callable=AsyncMock) as mock_reddit, \
             patch('services.context_fetcher.fetch_releases', new_callable=AsyncMock) as mock_releases:

            mock_hn.return_value = Exception("HN API Error")
            mock_reddit.return_value = Exception("Reddit API Error")
            mock_releases.return_value = []

            hn_count, reddit_count, release_count = await fetch_context_signals_for_repo(mock_repo, test_db)

            # Exceptions should result in 0 counts, not crash
            assert hn_count == 0
            assert reddit_count == 0
            assert release_count == 0


class TestFetchAllContextSignals:
    """Tests for fetch_all_context_signals function."""

    @pytest.mark.asyncio
    async def test_processes_all_repos(self, test_db, mock_multiple_repos):
        """Test processing all repos in watchlist."""
        with patch('services.context_fetcher.fetch_hn_mentions', new_callable=AsyncMock) as mock_hn, \
             patch('services.context_fetcher.fetch_reddit_mentions', new_callable=AsyncMock) as mock_reddit, \
             patch('services.context_fetcher.fetch_releases', new_callable=AsyncMock) as mock_releases:

            mock_hn.return_value = []
            mock_reddit.return_value = []
            mock_releases.return_value = []

            result = await fetch_all_context_signals(test_db)

            assert result["repos_processed"] == 3
            assert result["errors"] == 0

    @pytest.mark.asyncio
    async def test_handles_errors_gracefully(self, test_db, mock_repo):
        """Test that errors don't crash the entire process."""
        with patch('services.context_fetcher.fetch_context_signals_for_repo', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.side_effect = Exception("Test error")

            result = await fetch_all_context_signals(test_db)

            assert result["errors"] == 1
