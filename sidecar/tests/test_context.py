"""
Tests for context signal endpoints.
"""

from unittest.mock import patch, AsyncMock


class TestContextEndpoints:
    """Test cases for /api/context endpoints."""

    def test_get_context_badges_not_found(self, client):
        """Test getting context badges for nonexistent repo."""
        response = client.get("/api/context/99999/badges")
        assert response.status_code == 404

    def test_get_context_signals_not_found(self, client):
        """Test getting context signals for nonexistent repo."""
        response = client.get("/api/context/99999/signals")
        assert response.status_code == 404

    def test_get_context_signals_with_type(self, client):
        """Test getting context signals with type filter."""
        # This should return 404 since repo doesn't exist
        response = client.get("/api/context/99999/signals?signal_type=hacker_news")
        assert response.status_code == 404

    def test_fetch_context_not_found(self, client):
        """Test fetching context for nonexistent repo."""
        response = client.post("/api/context/99999/fetch")
        assert response.status_code == 404

    def test_get_context_badges_empty(self, client, mock_repo):
        """Test getting context badges when none exist."""
        response = client.get(f"/api/context/{mock_repo.id}/badges")
        assert response.status_code == 200
        data = response.json()
        # 驗證統一的 API 響應格式
        assert data["success"] is True
        assert "data" in data
        assert data["error"] is None
        badges_response = data["data"]
        assert badges_response["repo_id"] == mock_repo.id
        assert badges_response["badges"] == []

    def test_get_context_signals_empty(self, client, mock_repo):
        """Test getting context signals when none exist."""
        response = client.get(f"/api/context/{mock_repo.id}/signals")
        assert response.status_code == 200
        data = response.json()
        # 驗證統一的 API 響應格式
        assert data["success"] is True
        assert "data" in data
        assert data["error"] is None
        signals_response = data["data"]
        assert signals_response["repo_id"] == mock_repo.id
        assert signals_response["total"] == 0
        assert signals_response["signals"] == []

    def test_get_context_badges_batch_empty(self, client):
        """Test batch getting context badges with empty list."""
        response = client.post("/api/context/badges/batch", json={"repo_ids": []})
        assert response.status_code == 200
        data = response.json()
        # 驗證統一的 API 響應格式
        assert data["success"] is True
        assert "data" in data
        batch_response = data["data"]
        assert batch_response["results"] == {}

    def test_fetch_context_success(self, client, mock_repo):
        """Test fetching context signals successfully."""
        # Mock the fetch_context_signals_for_repo function
        with patch("routers.context.fetch_context_signals_for_repo", new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = 5
            response = client.post(f"/api/context/{mock_repo.id}/fetch")

        assert response.status_code == 200
        data = response.json()
        # 驗證統一的 API 響應格式
        assert data["success"] is True
        assert "data" in data
        fetch_response = data["data"]
        assert fetch_response["repo_id"] == mock_repo.id
        assert fetch_response["new_signals"]["hacker_news"] == 5

    def test_get_context_signals_invalid_type(self, client, mock_repo):
        """Test getting context signals with invalid signal_type."""
        response = client.get(f"/api/context/{mock_repo.id}/signals?signal_type=invalid_type")
        assert response.status_code == 400
        assert "Invalid signal_type" in response.json()["detail"]

    def test_get_context_signals_valid_type(self, client, mock_repo):
        """Test getting context signals with valid hacker_news type."""
        response = client.get(f"/api/context/{mock_repo.id}/signals?signal_type=hacker_news")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["total"] == 0

    def test_get_context_badges_with_signal(self, client, mock_repo, test_db):
        """Test getting badges when a high-score HN signal exists."""
        from db.models import ContextSignal
        from utils.time import utc_now

        signal = ContextSignal(
            repo_id=mock_repo.id,
            signal_type="hacker_news",
            external_id="hn_12345",
            title="Test HN post",
            url="https://news.ycombinator.com/item?id=12345",
            score=200,
            comment_count=50,
            author="testauthor",
            published_at=utc_now(),
            fetched_at=utc_now(),
        )
        test_db.add(signal)
        test_db.commit()

        response = client.get(f"/api/context/{mock_repo.id}/badges")
        assert response.status_code == 200
        data = response.json()
        badges = data["data"]["badges"]
        assert len(badges) == 1
        assert badges[0]["type"] == "hn"
        assert badges[0]["score"] == 200
        assert badges[0]["is_recent"] is True

    def test_get_context_badges_below_threshold(self, client, mock_repo, test_db):
        """Test badges filtered out when score is below threshold."""
        from db.models import ContextSignal
        from utils.time import utc_now

        signal = ContextSignal(
            repo_id=mock_repo.id,
            signal_type="hacker_news",
            external_id="hn_low",
            title="Low score post",
            url="https://news.ycombinator.com/item?id=99",
            score=10,  # Below MIN_HN_SCORE_FOR_BADGE (50)
            comment_count=2,
            author="lowauthor",
            published_at=utc_now(),
            fetched_at=utc_now(),
        )
        test_db.add(signal)
        test_db.commit()

        response = client.get(f"/api/context/{mock_repo.id}/badges")
        assert response.status_code == 200
        assert len(response.json()["data"]["badges"]) == 0

    def test_get_context_badges_not_recent(self, client, mock_repo, test_db):
        """Test badges with old published_at are marked not recent."""
        from datetime import timedelta
        from db.models import ContextSignal
        from utils.time import utc_now

        signal = ContextSignal(
            repo_id=mock_repo.id,
            signal_type="hacker_news",
            external_id="hn_old",
            title="Old HN post",
            url="https://news.ycombinator.com/item?id=555",
            score=300,
            comment_count=100,
            author="oldauthor",
            published_at=utc_now() - timedelta(days=30),
            fetched_at=utc_now(),
        )
        test_db.add(signal)
        test_db.commit()

        response = client.get(f"/api/context/{mock_repo.id}/badges")
        assert response.status_code == 200
        badges = response.json()["data"]["badges"]
        assert len(badges) == 1
        assert badges[0]["is_recent"] is False

    def test_batch_badges_with_data(self, client, mock_multiple_repos, test_db):
        """Test batch badge retrieval with actual signals."""
        from db.models import ContextSignal
        from utils.time import utc_now

        repo = mock_multiple_repos[0]
        signal = ContextSignal(
            repo_id=repo.id,
            signal_type="hacker_news",
            external_id="hn_batch1",
            title="Batch test",
            url="https://news.ycombinator.com/item?id=777",
            score=150,
            comment_count=30,
            author="batchauthor",
            published_at=utc_now(),
            fetched_at=utc_now(),
        )
        test_db.add(signal)
        test_db.commit()

        repo_ids = [r.id for r in mock_multiple_repos]
        response = client.post("/api/context/badges/batch", json={"repo_ids": repo_ids})
        assert response.status_code == 200
        data = response.json()
        results = data["data"]["results"]

        # repo with signal should have badge
        assert len(results[str(repo.id)]["badges"]) == 1
        assert results[str(repo.id)]["badges"][0]["score"] == 150

        # repos without signals should have empty badges
        for r in mock_multiple_repos[1:]:
            assert len(results[str(r.id)]["badges"]) == 0
