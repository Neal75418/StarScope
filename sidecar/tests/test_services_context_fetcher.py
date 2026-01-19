"""
Tests for services/context_fetcher.py - Context signal fetching service.
"""

from datetime import datetime, timezone
from unittest.mock import patch, AsyncMock, MagicMock

import pytest

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


def create_mock_reddit_post(post_id: str, title: str = "Test Reddit Post") -> MagicMock:
    """Create a mock Reddit post for testing."""
    post = MagicMock()
    post.post_id = post_id
    post.title = title
    post.permalink = f"https://reddit.com/r/programming/{post_id}"
    post.score = 200
    post.num_comments = 75
    post.author = "redditor"
    post.created_at = datetime.now(timezone.utc)
    return post


def create_mock_github_release(release_id: int, tag_name: str = "v1.0.0") -> MagicMock:
    """Create a mock GitHub release for testing."""
    release = MagicMock()
    release.release_id = release_id
    release.tag_name = tag_name
    release.name = f"Release {tag_name}"
    release.url = f"https://github.com/owner/repo/releases/{release_id}"
    release.author = "maintainer"
    release.is_draft = False
    release.is_prerelease = False
    release.published_at = datetime.now(timezone.utc)
    release.created_at = datetime.now(timezone.utc)
    return release


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
        stories = [create_mock_hn_story("hn1"), create_mock_hn_story("hn2")]
        count = context_fetcher_module._store_hn_signals(mock_repo.id, stories, test_db)

        assert count == 2

    def test_empty_stories(self, test_db, mock_repo):
        """Test with empty stories list."""
        count = context_fetcher_module._store_hn_signals(mock_repo.id, [], test_db)
        assert count == 0


class TestStoreRedditSignals:
    """Tests for _store_reddit_signals function."""

    def test_stores_new_signals(self, test_db, mock_repo):
        """Test storing new Reddit signals."""
        posts = [create_mock_reddit_post("r1"), create_mock_reddit_post("r2")]
        count = context_fetcher_module._store_reddit_signals(mock_repo.id, posts, test_db)

        assert count == 2

    def test_empty_posts(self, test_db, mock_repo):
        """Test with empty posts list."""
        count = context_fetcher_module._store_reddit_signals(mock_repo.id, [], test_db)
        assert count == 0


class TestStoreReleaseSignals:
    """Tests for _store_release_signals function."""

    def test_stores_new_releases(self, test_db, mock_repo):
        """Test storing new release signals."""
        releases = [
            create_mock_github_release(1, "v1.0"),
            create_mock_github_release(2, "v2.0"),
        ]
        count = context_fetcher_module._store_release_signals(
            mock_repo.id, releases, test_db
        )

        assert count == 2

    def test_filters_draft_releases(self, test_db, mock_repo):
        """Test that draft releases are filtered out."""
        release = create_mock_github_release(1, "v1.0")
        release.is_draft = True
        releases = [release]

        count = context_fetcher_module._store_release_signals(
            mock_repo.id, releases, test_db
        )
        assert count == 0

    def test_empty_releases(self, test_db, mock_repo):
        """Test with empty releases list."""
        count = context_fetcher_module._store_release_signals(mock_repo.id, [], test_db)
        assert count == 0


class TestFetchContextSignalsForRepo:
    """Tests for fetch_context_signals_for_repo function."""

    @pytest.mark.asyncio
    async def test_fetches_all_sources(self, test_db, mock_repo):
        """Test fetching from all sources in parallel."""
        with patch(
            'services.context_fetcher.fetch_hn_mentions', new_callable=AsyncMock
        ) as mock_hn, patch(
            'services.context_fetcher.fetch_reddit_mentions', new_callable=AsyncMock
        ) as mock_reddit, patch(
            'services.context_fetcher.fetch_releases', new_callable=AsyncMock
        ) as mock_releases:

            mock_hn.return_value = [create_mock_hn_story("hn1")]
            mock_reddit.return_value = [create_mock_reddit_post("r1")]
            mock_releases.return_value = [create_mock_github_release(1)]

            hn_count, reddit_count, release_count = await fetch_context_signals_for_repo(
                mock_repo, test_db
            )

            assert hn_count == 1
            assert reddit_count == 1
            assert release_count == 1

    @pytest.mark.asyncio
    async def test_handles_exceptions(self, test_db, mock_repo):
        """Test handling exceptions from fetchers."""
        with patch(
            'services.context_fetcher.fetch_hn_mentions', new_callable=AsyncMock
        ) as mock_hn, patch(
            'services.context_fetcher.fetch_reddit_mentions', new_callable=AsyncMock
        ) as mock_reddit, patch(
            'services.context_fetcher.fetch_releases', new_callable=AsyncMock
        ) as mock_releases:

            mock_hn.return_value = Exception("HN API Error")
            mock_reddit.return_value = Exception("Reddit API Error")
            mock_releases.return_value = []

            hn_count, reddit_count, release_count = await fetch_context_signals_for_repo(
                mock_repo, test_db
            )

            # Exceptions should result in 0 counts, not crash
            assert hn_count == 0
            assert reddit_count == 0
            assert release_count == 0


class TestFetchAllContextSignals:
    """Tests for fetch_all_context_signals function."""

    @pytest.mark.asyncio
    async def test_processes_all_repos(self, test_db, mock_multiple_repos):
        """Test processing all repos in watchlist."""
        with patch(
            'services.context_fetcher.fetch_hn_mentions', new_callable=AsyncMock
        ) as mock_hn, patch(
            'services.context_fetcher.fetch_reddit_mentions', new_callable=AsyncMock
        ) as mock_reddit, patch(
            'services.context_fetcher.fetch_releases', new_callable=AsyncMock
        ) as mock_releases:

            mock_hn.return_value = []
            mock_reddit.return_value = []
            mock_releases.return_value = []

            result = await fetch_all_context_signals(test_db)

            assert result["repos_processed"] == 3
            assert result["errors"] == 0

    @pytest.mark.asyncio
    async def test_handles_errors_gracefully(self, test_db, mock_repo):
        """Test that errors don't crash the entire process."""
        with patch(
            'services.context_fetcher.fetch_context_signals_for_repo',
            new_callable=AsyncMock,
        ) as mock_fetch:
            mock_fetch.side_effect = Exception("Test error")

            result = await fetch_all_context_signals(test_db)

            assert result["errors"] == 1
