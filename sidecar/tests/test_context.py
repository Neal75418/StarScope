"""
Tests for context signal endpoints.
"""


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
