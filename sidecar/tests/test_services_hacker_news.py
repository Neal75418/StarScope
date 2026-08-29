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
    close_hn_service,
    fetch_hn_mentions,
)
# Import module for accessing protected members in tests
from services import hacker_news as hn_module


def _service_answering(handler) -> HackerNewsService:
    """裝上真的 httpx.AsyncClient，只把傳輸層換成 MockTransport。

    不用 MagicMock 假冒 client：它的 .json() 是樁，回應想長什麼樣就長什麼樣，
    測不出真實回應的形狀（GitHub 那邊的 204 空 body 解析錯誤就是這樣整組躲過測試的）。
    順帶一提，這樣寫也不再綁定「client 是不是每次呼叫新建」這個實作細節。
    """
    service = HackerNewsService()
    service._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return service


def _hits(*hits: dict):
    """每次查詢都回同一批 hits 的 handler。"""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"hits": list(hits)})
    return handler


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

    def test_returns_none_on_invalid(self):
        """解析失敗回 None——先前偽造成 now() 會讓多年舊文以「剛剛」進入
        週報近 7 天過濾與 recent 徽章（第三方審查發現）。缺值比錯值誠實。"""
        assert hn_module._parse_created_at("invalid-timestamp") is None


    def test_empty_string_is_none_too(self):
        assert hn_module._parse_created_at("") is None


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
        seen_ids: set[str] = set()

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
        seen_ids: set[str] = {"12345"}

        result = hn_module._parse_hn_hit(hit, seen_ids)

        assert result is None

    def test_skips_missing_id(self):
        """Test skips hits without objectID."""
        hit = {"title": "Test"}
        seen_ids: set[str] = set()

        result = hn_module._parse_hn_hit(hit, seen_ids)

        assert result is None

    def test_generates_hn_url_when_missing(self):
        """Test generates HN URL when url is missing."""
        hit = {"objectID": "12345", "title": "Test", "url": None,
               "created_at": "2024-01-15T12:00:00Z"}
        seen_ids: set[str] = set()

        result = hn_module._parse_hn_hit(hit, seen_ids)

        assert result.url == "https://news.ycombinator.com/item?id=12345"

    def test_handles_missing_fields(self):
        """Test handles missing optional fields."""
        hit = {"objectID": "12345", "created_at": "2024-01-15T12:00:00Z"}
        seen_ids: set[str] = set()

        result = hn_module._parse_hn_hit(hit, seen_ids)

        assert result.title == ""
        assert result.points == 0
        assert result.num_comments == 0
        assert result.author == ""


    def test_hit_with_unparseable_time_is_skipped_entirely(self):
        """created_at 壞掉的 hit 回 None（跳過），而不是帶著偽造的「現在」進系統。"""
        hit = {"objectID": "99", "title": "old story", "created_at": "not-a-date"}
        assert hn_module._parse_hn_hit(hit, set()) is None


class TestExecuteHnQuery:
    """Tests for _execute_hn_query function."""

    @pytest.mark.asyncio
    async def test_successful_query(self):
        """Test successful HN query execution."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "hits": [
                {"objectID": "1", "title": "Story 1", "points": 100, "created_at": "2024-01-15T12:00:00Z"},
                {"objectID": "2", "title": "Story 2", "points": 50, "created_at": "2024-01-15T12:00:00Z"},
            ]
        }

        mock_client = AsyncMock()
        mock_client.get.return_value = mock_response

        stories, errors = await hn_module._execute_hn_query(mock_client, "test query", set())

        assert len(stories) == 2
        assert len(errors) == 0

    @pytest.mark.asyncio
    async def test_handles_rate_limit(self):
        """Test handles 429 rate limit response."""
        mock_response = MagicMock()
        mock_response.status_code = 429

        mock_client = AsyncMock()
        mock_client.get.return_value = mock_response

        stories, errors = await hn_module._execute_hn_query(mock_client, "test", set())

        assert len(stories) == 0
        assert "Rate limit" in errors[0]

    @pytest.mark.asyncio
    async def test_handles_timeout(self):
        """Test handles timeout exception."""
        mock_client = AsyncMock()
        mock_client.get.side_effect = httpx.TimeoutException("Timeout")

        stories, errors = await hn_module._execute_hn_query(mock_client, "test", set())

        assert len(stories) == 0
        assert "Timeout" in errors[0]

    @pytest.mark.asyncio
    async def test_handles_request_error(self):
        """Test handles network request error."""
        mock_client = AsyncMock()
        mock_client.get.side_effect = httpx.RequestError("Network error")

        stories, errors = await hn_module._execute_hn_query(mock_client, "test", set())

        assert len(stories) == 0
        assert len(errors) == 1


class TestHackerNewsService:
    """Tests for HackerNewsService class."""

    # 名字都用有識別度的 ripgrep：像 "repo" 這種四個字元的通用字，關聯判定會要求
    # 故事同時提到 owner（規則見 test_hn_relevance.py），那不是這一組要測的東西。
    @pytest.mark.asyncio
    async def test_search_repo_success(self):
        """Test successful repo search with relevant title."""
        service = _service_answering(_hits(
            {"objectID": "1", "title": "Introducing ripgrep: a new tool", "points": 100, "created_at": "2024-01-15T12:00:00Z"}
        ))

        result = await service.search_repo("ripgrep", "burntsushi")

        assert len(result) == 1
        assert isinstance(result[0], HNStory)
        await service.aclose()

    @pytest.mark.asyncio
    async def test_search_repo_filters_irrelevant(self):
        """Test irrelevant results are filtered out by relevance check."""
        service = _service_answering(_hits(
            {"objectID": "1", "title": "About myrepo project", "points": 100, "created_at": "2024-01-15T12:00:00Z"},
            {"objectID": "2", "title": "Unrelated article about cats", "points": 50, "created_at": "2024-01-15T12:00:00Z"},
        ))

        result = await service.search_repo("myrepo", "owner")

        assert len(result) == 1
        assert result[0].title == "About myrepo project"
        await service.aclose()

    @pytest.mark.asyncio
    async def test_search_repo_sorts_by_points(self):
        """Test results are sorted by points descending."""
        service = _service_answering(_hits(
            {"objectID": "1", "title": "Low score ripgrep mention", "points": 10, "created_at": "2024-01-15T12:00:00Z"},
            {"objectID": "2", "title": "High score ripgrep mention", "points": 100, "created_at": "2024-01-15T12:00:00Z"},
            {"objectID": "3", "title": "Medium score ripgrep mention", "points": 50, "created_at": "2024-01-15T12:00:00Z"},
        ))

        result = await service.search_repo("ripgrep", "burntsushi")

        # Should be sorted by points descending
        assert result[0].points >= result[1].points >= result[2].points
        await service.aclose()

    @pytest.mark.asyncio
    async def test_search_repo_raises_on_all_failures(self):
        """Test raises error when all queries fail."""
        def _always_times_out(request: httpx.Request) -> httpx.Response:
            raise httpx.TimeoutException("Timeout")

        service = _service_answering(_always_times_out)

        with pytest.raises(HackerNewsAPIError):
            await service.search_repo("ripgrep", "burntsushi")
        await service.aclose()


class TestGetHnService:
    """Tests for get_hn_service function."""

    @pytest.fixture(autouse=True)
    def reset_singleton(self):
        original = hn_module._default_service
        hn_module._default_service = None
        yield
        hn_module._default_service = original

    def test_returns_singleton(self):
        """Test returns the same instance."""
        s1 = get_hn_service()
        s2 = get_hn_service()

        assert s1 is s2

    @pytest.mark.asyncio
    async def test_close_hn_service_closes_the_client(self):
        """client 現在活過單次呼叫，所以關機時得有人負責關掉它。"""
        service = get_hn_service()
        client = service.client

        await close_hn_service()

        assert client.is_closed
        assert hn_module._default_service is None


class TestSharedClient:
    """client 的生命週期：整批掃描的成本主要在這裡。"""

    @pytest.mark.asyncio
    async def test_one_client_is_reused_across_calls(self):
        """每次呼叫開新 client 等於每次重跑 TLS 握手。

        94 個 repo × 2 次查詢實測 104 秒，光是改成共用連線就降到 80 秒——這條測的是
        那個 80 秒不會被改回去。
        """
        service = HackerNewsService()
        seen: list[httpx.AsyncClient] = []

        async def _capture(client, query, seen_ids):
            seen.append(client)
            return [], []

        with patch.object(hn_module, '_execute_hn_query', new=_capture):
            await service.search_repo("ripgrep", "burntsushi")
            await service.search_repo("other", "owner")

        assert len(seen) == 4, "兩次呼叫各查兩種寫法"
        assert len({id(c) for c in seen}) == 1, "四次查詢應共用同一個 client"

        await service.aclose()

    @pytest.mark.asyncio
    async def test_a_closed_client_is_replaced_rather_than_reused(self):
        """關掉之後再用會炸，所以 property 要能重建。"""
        service = HackerNewsService()
        first = service.client

        await service.aclose()

        assert first.is_closed
        assert service.client is not first
        await service.aclose()


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
        """Test returns None on unexpected error (e.g. data parsing)."""
        with patch.object(HackerNewsService, 'search_repo', new_callable=AsyncMock) as mock_search:
            mock_search.side_effect = ValueError("Unexpected data format")

            result = await fetch_hn_mentions("owner", "repo")

            assert result is None


class TestHackerNewsAPIError:
    """Tests for HackerNewsAPIError class."""

    def test_error_defaults_status_code_to_none(self):
        """Test that status_code defaults to None when not provided."""
        error = HackerNewsAPIError("Test error")
        assert error.status_code is None
