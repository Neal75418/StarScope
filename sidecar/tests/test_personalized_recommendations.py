"""
Tests for personalized recommendation endpoint.
"""

import json

from db.models import Repo, SimilarRepo, Signal, RepoSnapshot
from utils.time import utc_now


def _create_repo(db, owner, name, language="Python", topics=None):
    """Helper to create a repo in the database."""
    now = utc_now()
    repo = Repo(
        owner=owner,
        name=name,
        full_name=f"{owner}/{name}",
        url=f"https://github.com/{owner}/{name}",
        description=f"The {name} project",
        language=language,
        topics=topics or '[]',
        created_at=now,
        added_at=now,
        updated_at=now,
    )
    db.add(repo)
    db.commit()
    return repo


def _create_similarity(db, repo_id, similar_repo_id, score, shared_topics=None, same_lang=False):
    """Helper to create a SimilarRepo entry."""
    entry = SimilarRepo(
        repo_id=repo_id,
        similar_repo_id=similar_repo_id,
        similarity_score=score,
        shared_topics=json.dumps(shared_topics) if shared_topics else None,
        same_language=same_lang,
        calculated_at=utc_now(),
    )
    db.add(entry)
    db.commit()
    return entry


def _create_signal(db, repo_id, signal_type, value):
    """Helper to create a Signal entry."""
    signal = Signal(
        repo_id=repo_id,
        signal_type=signal_type,
        value=value,
        calculated_at=utc_now(),
    )
    db.add(signal)
    db.commit()
    return signal


def _create_snapshot(db, repo_id, stars):
    """Helper to create a RepoSnapshot."""
    snapshot = RepoSnapshot(
        repo_id=repo_id,
        stars=stars,
        forks=0,
        watchers=0,
        open_issues=0,
        snapshot_date=utc_now().date(),
        fetched_at=utc_now(),
    )
    db.add(snapshot)
    db.commit()
    return snapshot


class TestPersonalizedRecommendations:
    """Test cases for GET /api/recommendations/personalized."""

    def test_empty_watchlist(self, client):
        """When there are no repos at all, return empty recommendations."""
        response = client.get("/api/recommendations/personalized")
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total"] == 0
        assert data["recommendations"] == []
        assert data["based_on_repos"] == 0

    def test_no_similarities(self, client, mock_repo):
        """When watchlist has repos but no similarity data, return empty."""
        response = client.get("/api/recommendations/personalized")
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total"] == 0
        assert data["based_on_repos"] == 1

    def test_basic_recommendation(self, client, test_db):
        """Repo with similarity entry should appear as recommendation."""
        repo_a = _create_repo(
            test_db, "facebook", "react", "JavaScript", '["ui", "frontend"]'
        )
        repo_b = _create_repo(
            test_db, "preactjs", "preact", "JavaScript", '["ui", "lightweight"]'
        )
        _create_similarity(
            test_db, repo_a.id, repo_b.id, 0.75,
            shared_topics=["ui"], same_lang=True,
        )

        response = client.get("/api/recommendations/personalized")
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total"] == 1
        assert data["based_on_repos"] == 2

        rec = data["recommendations"][0]
        assert rec["repo_id"] == repo_b.id
        assert rec["full_name"] == "preactjs/preact"
        assert rec["similarity_score"] == 0.75
        assert rec["source_repo_id"] == repo_a.id
        assert rec["source_repo_name"] == "facebook/react"
        assert rec["shared_topics"] == ["ui"]
        assert rec["same_language"] is True

    def test_velocity_boost_ordering(self, client, test_db):
        """Repos with higher velocity should rank higher via boost."""
        main_repo = _create_repo(test_db, "owner", "main-repo")
        slow_repo = _create_repo(test_db, "ext", "slow-repo")
        fast_repo = _create_repo(test_db, "ext", "fast-repo")

        _create_similarity(test_db, main_repo.id, slow_repo.id, 0.6)
        _create_similarity(test_db, main_repo.id, fast_repo.id, 0.6)

        # fast-repo has high velocity, slow-repo has none
        _create_signal(test_db, fast_repo.id, "velocity", 15.0)

        response = client.get("/api/recommendations/personalized")
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total"] == 2

        # fast-repo should be first due to velocity boost
        assert data["recommendations"][0]["full_name"] == "ext/fast-repo"
        assert data["recommendations"][1]["full_name"] == "ext/slow-repo"

    def test_limit_parameter(self, client, test_db):
        """Limit parameter controls max returned recommendations."""
        main_repo = _create_repo(test_db, "owner", "main")
        for i in range(5):
            target = _create_repo(test_db, "ext", f"repo-{i}")
            _create_similarity(test_db, main_repo.id, target.id, 0.5 + i * 0.05)

        response = client.get("/api/recommendations/personalized?limit=3")
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total"] == 3

    def test_dedup_across_sources(self, client, test_db):
        """Same target repo similar to multiple sources should appear once with best score."""
        repo_a = _create_repo(test_db, "owner", "repo-a", "JavaScript")
        repo_b = _create_repo(test_db, "owner", "repo-b", "JavaScript")
        target = _create_repo(test_db, "ext", "common-similar", "JavaScript")

        # Similar to both, but with different scores
        _create_similarity(test_db, repo_a.id, target.id, 0.7)
        _create_similarity(test_db, repo_b.id, target.id, 0.9)

        response = client.get("/api/recommendations/personalized")
        assert response.status_code == 200
        data = response.json()["data"]

        # target should appear once with the higher adjusted score
        target_recs = [r for r in data["recommendations"] if r["repo_id"] == target.id]
        assert len(target_recs) == 1
        rec = target_recs[0]
        assert rec["similarity_score"] == 0.9  # higher score wins
        assert rec["source_repo_name"] == "owner/repo-b"

    def test_includes_stars_and_signals(self, client, test_db):
        """Recommendation should include stars, velocity, trend data."""
        source = _create_repo(test_db, "owner", "tracked")
        target = _create_repo(test_db, "ext", "popular")

        _create_similarity(test_db, source.id, target.id, 0.8)
        _create_snapshot(test_db, target.id, 5000)
        _create_signal(test_db, target.id, "velocity", 8.5)
        _create_signal(test_db, target.id, "trend", 1)

        response = client.get("/api/recommendations/personalized")
        assert response.status_code == 200
        rec = [r for r in response.json()["data"]["recommendations"] if r["repo_id"] == target.id][0]
        assert rec["stars"] == 5000
        assert rec["velocity"] == 8.5
        assert rec["trend"] == 1

    def test_structured_same_language(self, client, test_db):
        """same_language field should be true when applicable."""
        source = _create_repo(test_db, "owner", "py-proj", "Python")
        target = _create_repo(test_db, "ext", "py-lib", "Python")

        _create_similarity(
            test_db, source.id, target.id, 0.6,
            same_lang=True,
        )

        response = client.get("/api/recommendations/personalized")
        assert response.status_code == 200
        target_recs = [r for r in response.json()["data"]["recommendations"] if r["repo_id"] == target.id]
        assert len(target_recs) == 1
        assert target_recs[0]["same_language"] is True

    def test_velocity_boost_tiers(self, client, test_db):
        """Test that different velocity tiers produce correct ordering."""
        source = _create_repo(test_db, "owner", "main")

        ext_none = _create_repo(test_db, "ext", "no-velocity")
        ext_low = _create_repo(test_db, "ext", "low-velocity")
        ext_mid = _create_repo(test_db, "ext", "mid-velocity")
        ext_high = _create_repo(test_db, "ext", "high-velocity")

        for target in [ext_none, ext_low, ext_mid, ext_high]:
            _create_similarity(test_db, source.id, target.id, 0.5)

        # velocity: none, 3 (boost 0.05), 7 (boost 0.15), 12 (boost 0.3)
        _create_signal(test_db, ext_low.id, "velocity", 3.0)
        _create_signal(test_db, ext_mid.id, "velocity", 7.0)
        _create_signal(test_db, ext_high.id, "velocity", 12.0)

        response = client.get("/api/recommendations/personalized")
        assert response.status_code == 200
        recs = response.json()["data"]["recommendations"]
        # Filter to just our target repos (exclude 'main' if it appears)
        target_ids = {ext_none.id, ext_low.id, ext_mid.id, ext_high.id}
        filtered = [r for r in recs if r["repo_id"] in target_ids]
        names = [r["full_name"] for r in filtered]
        assert names[0] == "ext/high-velocity"
        assert names[1] == "ext/mid-velocity"
        assert names[2] == "ext/low-velocity"
        assert names[3] == "ext/no-velocity"

    def test_response_format(self, client, test_db):
        """Verify the response follows the ApiResponse wrapper format."""
        source = _create_repo(test_db, "owner", "src")
        target = _create_repo(test_db, "ext", "tgt")
        _create_similarity(test_db, source.id, target.id, 0.5)

        response = client.get("/api/recommendations/personalized")
        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert "data" in body
        data = body["data"]
        assert "recommendations" in data
        assert "total" in data
        assert "based_on_repos" in data

    def test_negative_velocity_no_boost(self, client, test_db):
        """Repos with negative velocity should get no boost."""
        source = _create_repo(test_db, "owner", "src")
        target_neg = _create_repo(test_db, "ext", "declining")
        target_pos = _create_repo(test_db, "ext", "growing")

        _create_similarity(test_db, source.id, target_neg.id, 0.7)
        _create_similarity(test_db, source.id, target_pos.id, 0.6)

        _create_signal(test_db, target_neg.id, "velocity", -5.0)
        _create_signal(test_db, target_pos.id, "velocity", 3.0)

        response = client.get("/api/recommendations/personalized")
        recs = response.json()["data"]["recommendations"]
        target_ids = {target_neg.id, target_pos.id}
        filtered = [r for r in recs if r["repo_id"] in target_ids]

        # target_neg: 0.7 * 1.0 = 0.7
        # target_pos: 0.6 * 1.05 = 0.63
        # target_neg still wins because base similarity is much higher
        assert filtered[0]["repo_id"] == target_neg.id
        assert filtered[1]["repo_id"] == target_pos.id
