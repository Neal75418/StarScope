"""
Tests for export endpoints.
"""


class TestExportEndpoints:
    """Test cases for /api/export endpoints."""

    def test_export_watchlist_json_empty(self, client):
        """Test exporting empty watchlist as JSON."""
        response = client.get("/api/export/watchlist.json")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/json"

    def test_export_watchlist_csv_empty(self, client):
        """Test exporting empty watchlist as CSV."""
        response = client.get("/api/export/watchlist.csv")
        assert response.status_code == 200
        assert "text/csv" in response.headers["content-type"]

    def test_export_history_not_found(self, client):
        """Test exporting history for nonexistent repo."""
        response = client.get("/api/export/history/99999.json")
        assert response.status_code == 404

    def test_export_history_csv_not_found(self, client):
        """Test exporting CSV history for nonexistent repo."""
        response = client.get("/api/export/history/99999.csv")
        assert response.status_code == 404

    def test_export_signals_json(self, client):
        """Test exporting signals as JSON."""
        response = client.get("/api/export/signals.json")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/json"

    def test_export_signals_csv(self, client):
        """Test exporting signals as CSV."""
        response = client.get("/api/export/signals.csv")
        assert response.status_code == 200
        assert "text/csv" in response.headers["content-type"]

    def test_export_full_report(self, client):
        """Test exporting full report."""
        response = client.get("/api/export/full-report.json")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/json"
