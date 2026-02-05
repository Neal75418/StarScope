"""
Tests for export endpoints.
Only watchlist.json is supported after simplification.
"""


class TestExportEndpoints:
    """Test cases for /api/export endpoints."""

    def test_export_watchlist_json_empty(self, client):
        """Test exporting empty watchlist as JSON."""
        response = client.get("/api/export/watchlist.json")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/json"
