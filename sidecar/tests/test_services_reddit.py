"""
Tests for services/reddit.py - Reddit API service.
"""

import pytest
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock, AsyncMock

import httpx

from services.reddit import (
    RedditService,
    RedditAPIError,
    RedditPost,
    get_reddit_service,
    fetch_reddit_mentions,
    PROGRAMMING_SUBREDDITS,
)
# Import module for accessing protected members in tests
from services import reddit as reddit_module


class TestParseCreatedUtc:
    """Tests for _parse_created_utc function."""

    def test_parses_valid_timestamp(self):
        """Test parses valid Unix timestamp."""
        # 2024-01-15 12:00:00 UTC
        timestamp = 1705320000.0
        result = reddit_module._parse_created_utc(timestamp)

        assert result.year == 2024
        assert result.month == 1
        assert result.tzinfo == timezone.utc

    def test_returns_now_on_invalid(self):
        """Test returns current time on invalid timestamp."""
        # Mock datetime.fromtimestamp to raise ValueError
        with patch('services.reddit.datetime') as mock_dt:
            mock_dt.fromtimestamp.side_effect = ValueError("Invalid timestamp")
            mock_dt.now.return_value = datetime.now(timezone.utc)
            result = reddit_module._parse_created_utc(12345)  # Any value will trigger the mock
        now = datetime.now(timezone.utc)
        # Should be recent
        assert (now - result).total_seconds() < 60


class TestIsValidPost:
    """Tests for _is_valid_post function."""

    def test_valid_post(self):
        """Test valid post returns True."""
        post_data = {
            "id": "abc123",
            "author": "testuser",
        }
        assert reddit_module._is_valid_post(post_data) is True

    def test_missing_id(self):
        """Test post without ID is invalid."""
        post_data = {"author": "testuser"}
        assert reddit_module._is_valid_post(post_data) is False

    def test_removed_post(self):
        """Test removed post is invalid."""
        post_data = {
            "id": "abc123",
            "removed_by_category": "moderator",
        }
        assert reddit_module._is_valid_post(post_data) is False

    def test_deleted_author(self):
        """Test post by deleted author is invalid."""
        post_data = {
            "id": "abc123",
            "author": "[deleted]",
        }
        assert reddit_module._is_valid_post(post_data) is False


class TestParseRedditPost:
    """Tests for _parse_reddit_post function."""

    def test_parses_valid_post(self):
        """Test parses valid Reddit post."""
        post_data = {
            "id": "abc123",
            "title": "Test Post",
            "url": "https://example.com",
            "permalink": "/r/programming/comments/abc123/test/",
            "score": 100,
            "num_comments": 50,
            "author": "testuser",
            "subreddit": "programming",
            "created_utc": 1705320000.0,
        }
        seen_ids = set()

        result = reddit_module._parse_reddit_post(post_data, seen_ids)

        assert result is not None
        assert result.post_id == "abc123"
        assert result.title == "Test Post"
        assert result.score == 100
        assert result.subreddit == "programming"

    def test_skips_duplicate_ids(self):
        """Test skips already seen IDs."""
        post_data = {"id": "abc123", "author": "user"}
        seen_ids = {"abc123"}

        result = reddit_module._parse_reddit_post(post_data, seen_ids)

        assert result is None

    def test_skips_invalid_post(self):
        """Test skips invalid post."""
        post_data = {"id": "abc123", "author": "[deleted]"}
        seen_ids = set()

        result = reddit_module._parse_reddit_post(post_data, seen_ids)

        assert result is None

    def test_handles_missing_fields(self):
        """Test handles missing optional fields."""
        post_data = {"id": "abc123", "author": "user"}
        seen_ids = set()

        result = reddit_module._parse_reddit_post(post_data, seen_ids)

        assert result.title == ""
        assert result.score == 0
        assert result.num_comments == 0


class TestExecuteRedditQuery:
    """Tests for _execute_reddit_query function."""

    @pytest.mark.asyncio
    async def test_successful_query(self):
        """Test successful Reddit query execution."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": {
                "children": [
                    {"data": {"id": "1", "title": "Post 1", "author": "user1", "score": 100}},
                    {"data": {"id": "2", "title": "Post 2", "author": "user2", "score": 50}},
                ]
            }
        }

        mock_client = AsyncMock()
        mock_client.get.return_value = mock_response

        posts = []
        seen_ids = set()
        errors = []

        await reddit_module._execute_reddit_query(
            mock_client, "https://reddit.com/search.json", "test", {}, seen_ids, posts, errors
        )

        assert len(posts) == 2
        assert len(errors) == 0

    @pytest.mark.asyncio
    async def test_handles_rate_limit(self):
        """Test handles 429 rate limit response."""
        mock_response = MagicMock()
        mock_response.status_code = 429

        mock_client = AsyncMock()
        mock_client.get.return_value = mock_response

        posts = []
        errors = []

        await reddit_module._execute_reddit_query(
            mock_client, "url", "test", {}, set(), posts, errors
        )

        assert len(posts) == 0
        assert "Rate limit" in errors[0]

    @pytest.mark.asyncio
    async def test_handles_forbidden(self):
        """Test handles 403 forbidden response."""
        mock_response = MagicMock()
        mock_response.status_code = 403

        mock_client = AsyncMock()
        mock_client.get.return_value = mock_response

        posts = []
        errors = []

        await reddit_module._execute_reddit_query(
            mock_client, "url", "test", {}, set(), posts, errors
        )

        assert len(posts) == 0
        assert "forbidden" in errors[0].lower()

    @pytest.mark.asyncio
    async def test_handles_timeout(self):
        """Test handles timeout exception."""
        mock_client = AsyncMock()
        mock_client.get.side_effect = httpx.TimeoutException("Timeout")

        posts = []
        errors = []

        await reddit_module._execute_reddit_query(
            mock_client, "url", "test", {}, set(), posts, errors
        )

        assert len(posts) == 0
        assert "Timeout" in errors[0]


class TestRedditService:
    """Tests for RedditService class."""

    def test_initialization(self):
        """Test service initialization with headers."""
        service = RedditService(timeout=30.0)

        assert service.timeout == pytest.approx(30.0)
        assert "User-Agent" in service.headers

    @pytest.mark.asyncio
    async def test_search_repo_success(self):
        """Test successful repo search."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": {
                "children": [
                    {"data": {"id": "1", "title": "Test", "author": "user", "score": 100}}
                ]
            }
        }

        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            service = RedditService()
            result = await service.search_repo("repo", "owner")

            assert len(result) >= 1
            assert isinstance(result[0], RedditPost)

    @pytest.mark.asyncio
    async def test_search_repo_sorts_by_score(self):
        """Test results are sorted by score descending."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": {
                "children": [
                    {"data": {"id": "1", "title": "Low", "author": "u1", "score": 10}},
                    {"data": {"id": "2", "title": "High", "author": "u2", "score": 100}},
                    {"data": {"id": "3", "title": "Medium", "author": "u3", "score": 50}},
                ]
            }
        }

        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            service = RedditService()
            result = await service.search_repo("repo", "owner")

            # Should be sorted by score descending
            assert result[0].score >= result[1].score >= result[2].score

    @pytest.mark.asyncio
    async def test_search_repo_raises_on_all_failures(self):
        """Test raises error when all queries fail."""
        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.side_effect = httpx.TimeoutException("Timeout")
            mock_client_class.return_value.__aenter__.return_value = mock_client

            service = RedditService()

            with pytest.raises(RedditAPIError):
                await service.search_repo("repo", "owner")


class TestGetRedditService:
    """Tests for get_reddit_service function."""

    def test_returns_singleton(self):
        """Test returns the same instance."""
        reddit_module._default_service = None

        s1 = get_reddit_service()
        s2 = get_reddit_service()

        assert s1 is s2

    def test_creates_instance(self):
        """Test creates RedditService instance."""
        reddit_module._default_service = None

        service = get_reddit_service()

        assert isinstance(service, RedditService)


class TestFetchRedditMentions:
    """Tests for fetch_reddit_mentions function."""

    @pytest.mark.asyncio
    async def test_returns_posts_on_success(self):
        """Test returns posts on successful fetch."""
        mock_posts = [
            RedditPost("1", "Test", "url", "perm", 100, 50, "author", "prog", datetime.now(timezone.utc))
        ]

        with patch.object(RedditService, 'search_repo', new_callable=AsyncMock) as mock_search:
            mock_search.return_value = mock_posts

            result = await fetch_reddit_mentions("owner", "repo")

            assert result == mock_posts

    @pytest.mark.asyncio
    async def test_returns_none_on_api_error(self):
        """Test returns None when API error occurs."""
        with patch.object(RedditService, 'search_repo', new_callable=AsyncMock) as mock_search:
            mock_search.side_effect = RedditAPIError("API Error")

            result = await fetch_reddit_mentions("owner", "repo")

            assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_on_unexpected_error(self):
        """Test returns None on unexpected error."""
        with patch.object(RedditService, 'search_repo', new_callable=AsyncMock) as mock_search:
            mock_search.side_effect = Exception("Unexpected error")

            result = await fetch_reddit_mentions("owner", "repo")

            assert result is None


class TestRedditAPIError:
    """Tests for RedditAPIError class."""

    def test_error_creation(self):
        """Test error creation with message and status code."""
        error = RedditAPIError("Test error", status_code=500)

        assert str(error) == "Test error"
        assert error.status_code == 500


class TestProgrammingSubreddits:
    """Tests for PROGRAMMING_SUBREDDITS constant."""

    def test_contains_expected_subreddits(self):
        """Test contains commonly expected programming subreddits."""
        assert "programming" in PROGRAMMING_SUBREDDITS
        assert "python" in PROGRAMMING_SUBREDDITS
        assert "javascript" in PROGRAMMING_SUBREDDITS
        assert "rust" in PROGRAMMING_SUBREDDITS
        assert "github" in PROGRAMMING_SUBREDDITS

    def test_is_non_empty_list(self):
        """Test is a non-empty list."""
        assert len(PROGRAMMING_SUBREDDITS) > 0
        assert isinstance(PROGRAMMING_SUBREDDITS, list)
