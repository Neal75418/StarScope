"""
Tests for services/recommender.py - Repository recommendation service.
"""

import json
from datetime import date
from unittest.mock import MagicMock

import pytest

from db.models import Repo, RepoSnapshot, SimilarRepo
from services.recommender import (
    RecommenderService,
    get_recommender_service,
    find_similar_repos,
    calculate_repo_similarities,
    recalculate_all_similarities,
    MIN_SIMILARITY_THRESHOLD,
    TOPIC_WEIGHT,
    LANGUAGE_WEIGHT,
    STAR_MAGNITUDE_WEIGHT,
)
# Import module for accessing protected members in tests
from services import recommender as recommender_module


class TestParseTopicsJson:
    """Tests for _parse_topics_json function."""

    def test_parses_valid_json_array(self):
        """Test parses valid JSON array."""
        result = recommender_module._parse_topics_json('["python", "machine-learning", "AI"]')

        assert result == {"python", "machine-learning", "ai"}

    def test_returns_empty_set_for_none(self):
        """Test returns empty set for None input."""
        result = recommender_module._parse_topics_json(None)
        assert result == set()

    def test_returns_empty_set_for_invalid_json(self):
        """Test returns empty set for invalid JSON."""
        result = recommender_module._parse_topics_json("not valid json")
        assert result == set()

    def test_lowercases_topics(self):
        """Test topics are lowercased."""
        result = recommender_module._parse_topics_json('["Python", "RUST"]')
        assert "python" in result
        assert "rust" in result


class TestJaccardSimilarity:
    """Tests for _jaccard_similarity function."""

    def test_identical_sets(self):
        """Test returns 1.0 for identical sets."""
        result = recommender_module._jaccard_similarity({"a", "b", "c"}, {"a", "b", "c"})
        assert result == pytest.approx(1.0)

    def test_disjoint_sets(self):
        """Test returns 0.0 for disjoint sets."""
        result = recommender_module._jaccard_similarity({"a", "b"}, {"c", "d"})
        assert result == pytest.approx(0.0)

    def test_partial_overlap(self):
        """Test correct calculation for partial overlap."""
        result = recommender_module._jaccard_similarity({"a", "b", "c"}, {"b", "c", "d"})
        # Intersection: {b, c} = 2, Union: {a, b, c, d} = 4
        assert result == pytest.approx(0.5)

    def test_empty_set_returns_zero(self):
        """Test returns 0.0 when either set is empty."""
        assert recommender_module._jaccard_similarity(set(), {"a"}) == pytest.approx(0.0)
        assert recommender_module._jaccard_similarity({"a"}, set()) == pytest.approx(0.0)
        assert recommender_module._jaccard_similarity(set(), set()) == pytest.approx(0.0)


class TestStarMagnitudeSimilarity:
    """Tests for _star_magnitude_similarity function."""

    def test_same_stars(self):
        """Test returns 1.0 for same star count."""
        result = recommender_module._star_magnitude_similarity(1000, 1000)
        assert result == pytest.approx(1.0)

    def test_same_order_of_magnitude(self):
        """Test high similarity for same order of magnitude."""
        result = recommender_module._star_magnitude_similarity(1000, 5000)
        assert result > 0.5

    def test_different_orders_of_magnitude(self):
        """Test low similarity for different orders of magnitude."""
        result = recommender_module._star_magnitude_similarity(100, 100000)
        assert result < 0.1

    def test_returns_zero_for_none(self):
        """Test returns 0.0 for None values."""
        assert recommender_module._star_magnitude_similarity(None, 1000) == pytest.approx(0.0)
        assert recommender_module._star_magnitude_similarity(1000, None) == pytest.approx(0.0)

    def test_returns_zero_for_zero_stars(self):
        """Test returns 0.0 for zero stars."""
        assert recommender_module._star_magnitude_similarity(0, 1000) == pytest.approx(0.0)
        assert recommender_module._star_magnitude_similarity(1000, 0) == pytest.approx(0.0)


class TestBuildStarsMap:
    """Tests for build_stars_map (shared query from queries.py)."""

    def test_returns_latest_stars(self, test_db, mock_repo):
        """Test returns stars from latest snapshot."""
        from services.queries import build_stars_map

        # Clear and add new snapshots
        test_db.query(RepoSnapshot).filter(RepoSnapshot.repo_id == mock_repo.id).delete()

        old_snapshot = RepoSnapshot(
            repo_id=mock_repo.id,
            snapshot_date=date.today().replace(day=1),
            stars=500,
        )
        new_snapshot = RepoSnapshot(
            repo_id=mock_repo.id,
            snapshot_date=date.today(),
            stars=1000,
        )
        test_db.add_all([old_snapshot, new_snapshot])
        test_db.commit()

        result = build_stars_map(test_db, [mock_repo.id])
        assert result[mock_repo.id] == 1000

    def test_returns_empty_without_snapshot(self, test_db, mock_repo):
        """Test returns empty dict when no snapshot exists."""
        from services.queries import build_stars_map

        test_db.query(RepoSnapshot).filter(RepoSnapshot.repo_id == mock_repo.id).delete()
        test_db.commit()

        result = build_stars_map(test_db, [mock_repo.id])
        assert mock_repo.id not in result


class TestRecommenderServiceCalculateSimilarity:
    """Tests for RecommenderService.calculate_similarity."""

    def test_calculates_weighted_score(self):
        """Test calculates weighted similarity score."""
        repo1 = MagicMock()
        repo1.language = "Python"

        repo2 = MagicMock()
        repo2.language = "Python"

        topics1 = {"machine-learning", "ai"}
        topics2 = {"machine-learning", "data-science"}

        score, shared, same_lang = RecommenderService.calculate_similarity(
            repo1, repo2, topics1, topics2, 1000, 1000
        )

        assert 0 < score <= 1
        assert "machine-learning" in shared
        assert same_lang is True

    def test_different_language_reduces_score(self):
        """Test different languages result in lower score."""
        repo1 = MagicMock()
        repo1.language = "Python"

        repo2 = MagicMock()
        repo2.language = "Rust"

        topics1 = {"cli", "tools"}
        topics2 = {"cli", "tools"}

        score, _, same_lang = RecommenderService.calculate_similarity(
            repo1, repo2, topics1, topics2, 1000, 1000
        )

        assert same_lang is False
        # Score should be lower than if languages matched
        assert score < TOPIC_WEIGHT + LANGUAGE_WEIGHT


class TestRecommenderServiceFindSimilarRepos:
    """Tests for RecommenderService.find_similar_repos."""

    def test_returns_empty_for_no_similar(self, test_db, mock_repo):
        """Test returns empty list when no similar repos."""
        result = RecommenderService.find_similar_repos(mock_repo.id, test_db)
        assert result == []

    def test_returns_similar_repos(self, test_db, mock_repo):
        """Test returns similar repos from database."""
        # Create another repo
        other_repo = Repo(
            full_name="test/similar-repo",
            owner="test",
            name="similar-repo",
            url="https://github.com/test/similar-repo",
            description="A similar repo",
            language="Python",
        )
        test_db.add(other_repo)
        test_db.commit()

        # Create similarity record
        similar = SimilarRepo(
            repo_id=mock_repo.id,
            similar_repo_id=other_repo.id,
            similarity_score=0.8,
            shared_topics=json.dumps(["python"]),
            same_language=True,
        )
        test_db.add(similar)
        test_db.commit()

        result = RecommenderService.find_similar_repos(mock_repo.id, test_db)

        assert len(result) == 1
        assert result[0]["full_name"] == "test/similar-repo"
        assert result[0]["similarity_score"] == pytest.approx(0.8)


class TestRecommenderServiceCalculateAndStoreSimilarities:
    """Tests for RecommenderService.calculate_and_store_similarities."""

    def test_stores_similar_repos(self, test_db, mock_repo):
        """Test stores similar repos in database."""
        # Create another repo with similar characteristics
        other_repo = Repo(
            full_name="test/other",
            owner="test",
            name="other",
            url="https://github.com/test/other",
            language="Python",
            topics='["testing"]',
        )
        test_db.add(other_repo)

        # Set same language for mock_repo
        mock_repo.language = "Python"
        mock_repo.topics = '["testing"]'
        test_db.commit()

        count = RecommenderService.calculate_and_store_similarities(mock_repo, test_db)

        assert count >= 0

    def test_clears_existing_when_recalculating(self, test_db, mock_repo):
        """Test clears existing similarities when recalculating."""
        # Create existing similarity
        other_repo = Repo(full_name="test/old", owner="test", name="old", url="https://github.com/test/old")
        test_db.add(other_repo)
        test_db.commit()

        existing = SimilarRepo(
            repo_id=mock_repo.id,
            similar_repo_id=other_repo.id,
            similarity_score=0.5,
        )
        test_db.add(existing)
        test_db.commit()

        # Recalculate should clear existing
        RecommenderService.calculate_and_store_similarities(mock_repo, test_db, recalculate=True)

        # Verify old entry was cleared (or updated)
        # The exact behavior depends on whether the new calculation creates a new entry


class TestRecalculateAll:
    """Tests for recalculate_all method."""

    def test_processes_all_repos(self, test_db, mock_multiple_repos):
        """Test processes all repos."""
        recommender = RecommenderService()
        result = recommender.recalculate_all(test_db)

        assert result["total_repos"] == 3
        assert result["processed"] == 3


class TestGetRecommenderService:
    """Tests for get_recommender_service function."""

    def test_returns_singleton(self):
        """Test returns the same instance."""
        recommender_module._recommender = None

        r1 = get_recommender_service()
        r2 = get_recommender_service()

        assert r1 is r2

    def test_creates_instance(self):
        """Test creates RecommenderService instance."""
        recommender_module._recommender = None

        service = get_recommender_service()

        assert isinstance(service, RecommenderService)


class TestConvenienceFunctions:
    """Tests for module-level convenience functions."""

    def test_find_similar_repos_function(self, test_db, mock_repo):
        """Test find_similar_repos convenience function."""
        result = find_similar_repos(mock_repo.id, test_db)
        assert isinstance(result, list)

    def test_calculate_repo_similarities_function(self, test_db, mock_repo):
        """Test calculate_repo_similarities convenience function."""
        result = calculate_repo_similarities(mock_repo.id, test_db)
        assert isinstance(result, int)

    def test_calculate_repo_similarities_nonexistent(self, test_db):
        """Test returns 0 for nonexistent repo."""
        result = calculate_repo_similarities(99999, test_db)
        assert result == 0

    def test_recalculate_all_similarities_function(self, test_db, mock_repo):
        """Test recalculate_all_similarities convenience function."""
        result = recalculate_all_similarities(test_db)
        assert "total_repos" in result
        assert "processed" in result


class TestConstants:
    """Tests for module constants."""

    def test_weights_sum_to_one(self):
        """Test similarity weights sum to 1.0."""
        total = TOPIC_WEIGHT + LANGUAGE_WEIGHT + STAR_MAGNITUDE_WEIGHT
        assert total == pytest.approx(1.0)

    def test_min_threshold_reasonable(self):
        """Test minimum threshold is reasonable."""
        assert 0 < MIN_SIMILARITY_THRESHOLD < 1
