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
