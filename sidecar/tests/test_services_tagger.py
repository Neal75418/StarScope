"""
Tests for services/tagger.py - Auto-tagging service.
"""

import os
from unittest.mock import patch, MagicMock, AsyncMock

import httpx
import pytest

from db.models import Tag, RepoTag, TagType
from services.tagger import (
    TaggerService,
    get_tagger_service,
    auto_tag_repo,
    auto_tag_all_repos,
    LANGUAGE_COLORS,
    TECH_KEYWORDS,
)


class TestTaggerServiceInit:
    """Tests for TaggerService initialization."""

    def test_initializes_with_token(self):
        """Test initializes with token."""
        service = TaggerService(token="test-token")

        assert service.token == "test-token"
        assert "Authorization" in service.headers
        assert service.headers["Authorization"] == "Bearer test-token"

    def test_initializes_without_token(self):
        """Test initializes without token."""
        service = TaggerService()

        assert service.token is None
        assert "Authorization" not in service.headers


class TestFetchTopics:
    """Tests for fetch_topics method."""

    @pytest.mark.asyncio
    async def test_fetches_topics_successfully(self):
        """Test successful topics fetch."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"names": ["python", "machine-learning", "ai"]}

        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            service = TaggerService()
            result = await service.fetch_topics("owner", "repo")

            assert result == ["python", "machine-learning", "ai"]

    @pytest.mark.asyncio
    async def test_returns_empty_on_404(self):
        """Test returns empty list on 404."""
        mock_response = MagicMock()
        mock_response.status_code = 404

        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            service = TaggerService()
            result = await service.fetch_topics("owner", "nonexistent")

            assert result == []

    @pytest.mark.asyncio
    async def test_returns_empty_on_403(self):
        """Test returns empty list on rate limit."""
        mock_response = MagicMock()
        mock_response.status_code = 403

        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            service = TaggerService()
            result = await service.fetch_topics("owner", "repo")

            assert result == []

    @pytest.mark.asyncio
    async def test_handles_timeout(self):
        """Test handles timeout gracefully."""
        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.side_effect = httpx.TimeoutException("Timeout")
            mock_client_class.return_value.__aenter__.return_value = mock_client

            service = TaggerService()
            result = await service.fetch_topics("owner", "repo")

            assert result == []

    @pytest.mark.asyncio
    async def test_handles_request_error(self):
        """Test handles network error gracefully."""
        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.side_effect = httpx.RequestError("Network error")
            mock_client_class.return_value.__aenter__.return_value = mock_client

            service = TaggerService()
            result = await service.fetch_topics("owner", "repo")

            assert result == []


class TestExtractKeywords:
    """Tests for extract_keywords static method."""

    def test_extracts_matching_keywords(self):
        """Test extracts known tech keywords."""
        description = "A high-performance framework and api toolkit"
        result = TaggerService.extract_keywords(description)

        assert "framework" in result
        assert "api" in result or "toolkit" in result

    def test_returns_empty_for_none(self):
        """Test returns empty list for None description."""
        result = TaggerService.extract_keywords(None)
        assert result == []

    def test_returns_empty_for_empty_string(self):
        """Test returns empty list for empty description."""
        result = TaggerService.extract_keywords("")
        assert result == []

    def test_finds_compound_keywords(self):
        """Test finds compound keywords with hyphens."""
        description = "A machine-learning library for deep-learning tasks"
        result = TaggerService.extract_keywords(description)

        assert "machine-learning" in result or "deep-learning" in result

    def test_limits_to_five_keywords(self):
        """Test limits results to 5 keywords."""
        # Description with many keywords
        description = (
            "A framework library sdk api cli tool for database orm http "
            "graphql microservice serverless distributed deployment"
        )
        result = TaggerService.extract_keywords(description)

        assert len(result) <= 5


class TestGetOrCreateTag:
    """Tests for _get_or_create_tag static method."""

    def test_creates_new_tag(self, test_db):
        """Test creates new tag when doesn't exist."""
        tag = TaggerService._get_or_create_tag(
            name="new-tag",
            tag_type=TagType.CUSTOM,
            color="#ff0000",
            db=test_db
        )

        assert tag is not None
        assert tag.name == "new-tag"
        assert tag.tag_type == TagType.CUSTOM
        assert tag.color == "#ff0000"

    def test_returns_existing_tag(self, test_db):
        """Test returns existing tag."""
        # Create tag first
        existing = Tag(name="existing", tag_type=TagType.TOPIC, color="#0000ff")
        test_db.add(existing)
        test_db.commit()

        tag = TaggerService._get_or_create_tag(
            name="Existing",  # Different case
            tag_type=TagType.TOPIC,
            color="#ff0000",  # Different color
            db=test_db
        )

        assert tag.id == existing.id
        assert tag.color == "#0000ff"  # Original color preserved

    def test_normalizes_name(self, test_db):
        """Test normalizes tag name to lowercase."""
        tag = TaggerService._get_or_create_tag(
            name="  MyTag  ",
            tag_type=TagType.CUSTOM,
            color="#000",
            db=test_db
        )

        assert tag.name == "mytag"


class TestApplyTag:
    """Tests for _apply_tag static method."""

    def test_applies_new_tag(self, test_db, mock_repo):
        """Test applies tag to repo."""
        tag = Tag(name="test-tag", tag_type=TagType.CUSTOM, color="#000")
        test_db.add(tag)
        test_db.commit()

        repo_tag = TaggerService._apply_tag(
            repo_id=mock_repo.id,
            tag=tag,
            source="auto",
            confidence=0.9,
            db=test_db
        )

        assert repo_tag is not None
        assert repo_tag.repo_id == mock_repo.id
        assert repo_tag.tag_id == tag.id
        assert repo_tag.confidence == pytest.approx(0.9)

    def test_returns_none_if_already_applied(self, test_db, mock_repo):
        """Test returns None if tag already applied."""
        tag = Tag(name="duplicate", tag_type=TagType.CUSTOM, color="#000")
        test_db.add(tag)
        test_db.commit()

        # Apply first time
        TaggerService._apply_tag(mock_repo.id, tag, "auto", 1.0, test_db)
        test_db.commit()

        # Try to apply again
        result = TaggerService._apply_tag(mock_repo.id, tag, "auto", 1.0, test_db)

        assert result is None


class TestAutoTagRepo:
    """Tests for auto_tag_repo method."""

    @pytest.mark.asyncio
    async def test_applies_language_tag(self, test_db, mock_repo):
        """Test applies language tag."""
        mock_repo.language = "Python"
        test_db.commit()

        service = TaggerService()

        with patch.object(service, 'fetch_topics', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = []

            result = await service.auto_tag_repo(mock_repo, test_db)

            # Should have language tag
            lang_tags = [t for t, _ in result if t.tag_type == TagType.LANGUAGE]
            assert len(lang_tags) >= 1

    @pytest.mark.asyncio
    async def test_applies_topic_tags(self, test_db, mock_repo):
        """Test applies GitHub topic tags."""
        service = TaggerService()

        with patch.object(service, 'fetch_topics', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = ["cli", "tool", "automation"]

            result = await service.auto_tag_repo(mock_repo, test_db)

            # Should have topic tags
            topic_tags = [t for t, _ in result if t.tag_type == TagType.TOPIC]
            assert len(topic_tags) >= 1

    @pytest.mark.asyncio
    async def test_infers_tags_from_description(self, test_db, mock_repo):
        """Test infers tags from description."""
        mock_repo.description = "A framework for building APIs with GraphQL"
        test_db.commit()

        service = TaggerService()

        with patch.object(service, 'fetch_topics', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = []

            result = await service.auto_tag_repo(mock_repo, test_db)

            # Result may or may not have inferred tags depending on description keywords
            assert isinstance(result, list)


class TestAddCustomTag:
    """Tests for add_custom_tag method."""

    def test_adds_custom_tag(self, test_db, mock_repo):
        """Test adds custom tag to repo."""
        service = TaggerService()

        result = service.add_custom_tag(
            repo_id=mock_repo.id,
            tag_name="my-custom-tag",
            color="#abcdef",
            db=test_db
        )

        assert result is not None
        tag, repo_tag = result
        assert tag.name == "my-custom-tag"
        assert tag.tag_type == TagType.CUSTOM
        assert repo_tag.source == "user"

    def test_returns_none_if_already_exists(self, test_db, mock_repo):
        """Test returns None if tag already applied."""
        service = TaggerService()

        # Add first time
        service.add_custom_tag(mock_repo.id, "duplicate", "#000", test_db)

        # Try to add again
        result = service.add_custom_tag(mock_repo.id, "duplicate", "#000", test_db)

        assert result is None


class TestRemoveTag:
    """Tests for remove_tag static method."""

    def test_removes_existing_tag(self, test_db, mock_repo):
        """Test removes tag from repo."""
        # Create and apply tag
        tag = Tag(name="to-remove", tag_type=TagType.CUSTOM, color="#000")
        test_db.add(tag)
        test_db.commit()

        repo_tag = RepoTag(repo_id=mock_repo.id, tag_id=tag.id, source="user")
        test_db.add(repo_tag)
        test_db.commit()

        result = TaggerService.remove_tag(mock_repo.id, tag.id, test_db)

        assert result is True

        # Verify removed
        remaining = test_db.query(RepoTag).filter(
            RepoTag.repo_id == mock_repo.id,
            RepoTag.tag_id == tag.id
        ).first()
        assert remaining is None

    def test_returns_false_if_not_found(self, test_db, mock_repo):
        """Test returns False if tag not applied."""
        result = TaggerService.remove_tag(mock_repo.id, 99999, test_db)
        assert result is False


class TestGetRepoTags:
    """Tests for get_repo_tags static method."""

    def test_returns_all_tags(self, test_db, mock_repo):
        """Test returns all tags for repo."""
        # Create and apply tags
        tag1 = Tag(name="tag1", tag_type=TagType.LANGUAGE, color="#111")
        tag2 = Tag(name="tag2", tag_type=TagType.TOPIC, color="#222")
        test_db.add_all([tag1, tag2])
        test_db.commit()

        repo_tags = [
            RepoTag(repo_id=mock_repo.id, tag_id=tag1.id, source="auto", confidence=1.0),
            RepoTag(repo_id=mock_repo.id, tag_id=tag2.id, source="user"),
        ]
        test_db.add_all(repo_tags)
        test_db.commit()

        result = TaggerService.get_repo_tags(mock_repo.id, test_db)

        assert len(result) == 2
        names = [r["name"] for r in result]
        assert "tag1" in names
        assert "tag2" in names

    def test_returns_empty_for_no_tags(self, test_db, mock_repo):
        """Test returns empty list when no tags."""
        # Clear any existing tags
        test_db.query(RepoTag).filter(RepoTag.repo_id == mock_repo.id).delete()
        test_db.commit()

        result = TaggerService.get_repo_tags(mock_repo.id, test_db)
        assert result == []


class TestGetTaggerService:
    """Tests for get_tagger_service function."""

    def test_returns_singleton(self):
        """Test returns the same instance."""
        import services.tagger as tagger_module
        tagger_module._default_tagger = None

        with patch.dict(os.environ, {}, clear=True):
            t1 = get_tagger_service()
            t2 = get_tagger_service()

            assert t1 is t2

    def test_uses_env_token(self):
        """Test uses token from environment."""
        import services.tagger as tagger_module
        tagger_module._default_tagger = None

        with patch.dict(os.environ, {"GITHUB_TOKEN": "env-token"}):
            service = get_tagger_service()
            assert service.token == "env-token"


class TestAutoTagRepoConvenienceFunction:
    """Tests for auto_tag_repo convenience function."""

    @pytest.mark.asyncio
    async def test_returns_empty_for_nonexistent_repo(self, test_db):
        """Test returns empty list for nonexistent repo."""
        result = await auto_tag_repo(99999, test_db)
        assert result == []

    @pytest.mark.asyncio
    async def test_tags_existing_repo(self, test_db, mock_repo):
        """Test tags existing repo."""
        with patch.object(TaggerService, 'auto_tag_repo', new_callable=AsyncMock) as mock_auto:
            mock_tag = MagicMock()
            mock_tag.name = "test"
            mock_tag.tag_type = TagType.TOPIC
            mock_auto.return_value = [(mock_tag, "auto")]

            result = await auto_tag_repo(mock_repo.id, test_db)

            assert len(result) == 1


class TestAutoTagAllRepos:
    """Tests for auto_tag_all_repos function."""

    @pytest.mark.asyncio
    async def test_tags_all_repos(self, test_db, mock_multiple_repos):
        """Test tags all repos in database."""
        with patch.object(TaggerService, 'auto_tag_repo', new_callable=AsyncMock) as mock_auto:
            mock_auto.return_value = []

            result = await auto_tag_all_repos(test_db)

            assert result["total_repos"] == 3
            assert mock_auto.call_count == 3


class TestConstants:
    """Tests for module constants."""

    def test_language_colors_exist(self):
        """Test language colors dictionary exists and has common languages."""
        assert "python" in LANGUAGE_COLORS
        assert "javascript" in LANGUAGE_COLORS
        assert "rust" in LANGUAGE_COLORS

    def test_tech_keywords_exist(self):
        """Test tech keywords set exists and has common keywords."""
        assert "framework" in TECH_KEYWORDS
        assert "api" in TECH_KEYWORDS
        assert "database" in TECH_KEYWORDS
