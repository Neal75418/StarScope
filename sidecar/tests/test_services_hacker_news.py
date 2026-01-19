"""
Tests for services/hacker_news.py - Hacker News API service.
"""

import pytest
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock, AsyncMock

import httpx

from services.hacker_news import (
    HackerNewsService,
    HackerNewsAPIError,
    HNStory,
    get_hn_service,
    fetch_hn_mentions,
)
# Import module for accessing protected members in tests
from services import hacker_news as hn_module


class TestParseCreatedAt:
    """Tests for _parse_created_at function."""

    def test_parses_valid_timestamp(self):
        """Test parses valid ISO timestamp."""
        result = hn_module._parse_created_at("2024-01-15T12:30:00Z")
        assert result.year == 2024
        assert result.month == 1
        assert result.day == 15

    def test_parses_with_timezone(self):
        """Test parses timestamp with timezone."""
        result = hn_module._parse_created_at("2024-01-15T12:30:00+00:00")
        assert result.tzinfo is not None

    def test_returns_now_on_invalid(self):
        """Test returns current time on invalid timestamp."""
        result = hn_module._parse_created_at("invalid-timestamp")
        assert result.tzinfo == timezone.utc
        # Should be recent (within last minute)
        now = datetime.now(timezone.utc)
        assert (now - result).total_seconds() < 60

    def test_handles_empty_string(self):
        """Test handles empty string input gracefully."""
        result = hn_module._parse_created_at("")
        assert result.tzinfo == timezone.utc


class TestParseHnHit:
    """Tests for _parse_hn_hit function."""

    def test_parses_valid_hit(self):
        """Test parses valid HN hit."""
        hit = {
            "objectID": "12345",
            "title": "Test Story",
            "url": "https://example.com",
            "points": 100,
            "num_comments": 50,
            "author": "testuser",
            "created_at": "2024-01-15T12:00:00Z",
        }
        seen_ids = set()

        result = hn_module._parse_hn_hit(hit, seen_ids)

        assert result is not None
        assert result.object_id == "12345"
        assert result.title == "Test Story"
        assert result.url == "https://example.com"
        assert result.points == 100
        assert result.num_comments == 50
        assert result.author == "testuser"

    def test_skips_duplicate_ids(self):
        """Test skips already seen IDs."""
        hit = {"objectID": "12345", "title": "Test"}
        seen_ids = {"12345"}

        result = hn_module._parse_hn_hit(hit, seen_ids)

        assert result is None

    def test_skips_missing_id(self):
        """Test skips hits without objectID."""
        hit = {"title": "Test"}
        seen_ids = set()

        result = hn_module._parse_hn_hit(hit, seen_ids)

        assert result is None

    def test_generates_hn_url_when_missing(self):
        """Test generates HN URL when url is missing."""
        hit = {"objectID": "12345", "title": "Test", "url": None}
        seen_ids = set()

        result = hn_module._parse_hn_hit(hit, seen_ids)

        assert result.url == "https://news.ycombinator.com/item?id=12345"

    def test_handles_missing_fields(self):
        """Test handles missing optional fields."""
        hit = {"objectID": "12345"}
        seen_ids = set()

        result = hn_module._parse_hn_hit(hit, seen_ids)

        assert result.title == ""
        assert result.points == 0
        assert result.num_comments == 0
        assert result.author == ""


class TestExecuteHnQuery:
    """Tests for _execute_hn_query function."""

    @pytest.mark.asyncio
    async def test_successful_query(self):
        """Test successful HN query execution."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "hits": [
                {"objectID": "1", "title": "Story 1", "points": 100},
                {"objectID": "2", "title": "Story 2", "points": 50},
            ]
        }

        mock_client = AsyncMock()
        mock_client.get.return_value = mock_response

        stories = []
        seen_ids = set()
        errors = []

        await hn_module._execute_hn_query(mock_client, "test query", seen_ids, stories, errors)

        assert len(stories) == 2
        assert len(errors) == 0

    @pytest.mark.asyncio
    async def test_handles_rate_limit(self):
        """Test handles 429 rate limit response."""
        mock_response = MagicMock()
        mock_response.status_code = 429

        mock_client = AsyncMock()
        mock_client.get.return_value = mock_response

        stories = []
        errors = []

        await hn_module._execute_hn_query(mock_client, "test", set(), stories, errors)

        assert len(stories) == 0
        assert "Rate limit" in errors[0]

    @pytest.mark.asyncio
    async def test_handles_timeout(self):
        """Test handles timeout exception."""
        mock_client = AsyncMock()
        mock_client.get.side_effect = httpx.TimeoutException("Timeout")

        stories = []
        errors = []

        await hn_module._execute_hn_query(mock_client, "test", set(), stories, errors)

        assert len(stories) == 0
        assert "Timeout" in errors[0]

    @pytest.mark.asyncio
    async def test_handles_request_error(self):
        """Test handles network request error."""
        mock_client = AsyncMock()
        mock_client.get.side_effect = httpx.RequestError("Network error")

        stories = []
        errors = []

        await hn_module._execute_hn_query(mock_client, "test", set(), stories, errors)

        assert len(stories) == 0
        assert len(errors) == 1


class TestHackerNewsService:
    """Tests for HackerNewsService class."""

    @pytest.mark.asyncio
    async def test_search_repo_success(self):
        """Test successful repo search."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "hits": [{"objectID": "1", "title": "Test", "points": 100}]
        }

        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            service = HackerNewsService()
            result = await service.search_repo("repo", "owner")

            assert len(result) >= 1
            assert isinstance(result[0], HNStory)

    @pytest.mark.asyncio
    async def test_search_repo_sorts_by_points(self):
        """Test results are sorted by points descending."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "hits": [
                {"objectID": "1", "title": "Low", "points": 10},
                {"objectID": "2", "title": "High", "points": 100},
                {"objectID": "3", "title": "Medium", "points": 50},
            ]
        }

        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            service = HackerNewsService()
            result = await service.search_repo("repo", "owner")

            # Should be sorted by points descending
            assert result[0].points >= result[1].points >= result[2].points

    @pytest.mark.asyncio
    async def test_search_repo_raises_on_all_failures(self):
        """Test raises error when all queries fail."""
        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.side_effect = httpx.TimeoutException("Timeout")
            mock_client_class.return_value.__aenter__.return_value = mock_client

            service = HackerNewsService()

            with pytest.raises(HackerNewsAPIError):
                await service.search_repo("repo", "owner")


class TestGetHnService:
    """Tests for get_hn_service function."""

    def test_returns_singleton(self):
        """Test returns the same instance."""
        hn_module._default_service = None

        s1 = get_hn_service()
        s2 = get_hn_service()

        assert s1 is s2

    def test_creates_instance(self):
        """Test creates HackerNewsService instance."""
        hn_module._default_service = None

        service = get_hn_service()

        assert isinstance(service, HackerNewsService)


class TestFetchHnMentions:
    """Tests for fetch_hn_mentions function."""

    @pytest.mark.asyncio
    async def test_returns_stories_on_success(self):
        """Test returns stories on successful fetch."""
        mock_stories = [HNStory("1", "Test", "url", 100, 50, "author", datetime.now(timezone.utc))]

        with patch.object(HackerNewsService, 'search_repo', new_callable=AsyncMock) as mock_search:
            mock_search.return_value = mock_stories

            result = await fetch_hn_mentions("owner", "repo")

            assert result == mock_stories

    @pytest.mark.asyncio
    async def test_returns_none_on_api_error(self):
        """Test returns None when API error occurs."""
        with patch.object(HackerNewsService, 'search_repo', new_callable=AsyncMock) as mock_search:
            mock_search.side_effect = HackerNewsAPIError("API Error")

            result = await fetch_hn_mentions("owner", "repo")

            assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_on_unexpected_error(self):
        """Test returns None on unexpected error."""
        with patch.object(HackerNewsService, 'search_repo', new_callable=AsyncMock) as mock_search:
            mock_search.side_effect = Exception("Unexpected error")

            result = await fetch_hn_mentions("owner", "repo")

            assert result is None


class TestHackerNewsAPIError:
    """Tests for HackerNewsAPIError class."""

    def test_error_creation(self):
        """Test error creation with message and status code."""
        error = HackerNewsAPIError("Test error", status_code=500)

        assert str(error) == "Test error"
        assert error.status_code == 500

    def test_error_without_status_code(self):
        """Test error creation without status code."""
        error = HackerNewsAPIError("Test error")

        assert str(error) == "Test error"
        assert error.status_code is None
