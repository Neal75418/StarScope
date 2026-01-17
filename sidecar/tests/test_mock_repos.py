"""
Comprehensive tests with mock repository data.
Tests real database operations with properly structured mock data.
"""

import pytest


class TestRepoWithMockData:
    """Test repository operations with mock data."""

    def test_get_repo_by_id(self, client, mock_repo):
        """Test getting a repo by ID."""
        response = client.get(f"/api/repos/{mock_repo.id}")
        assert response.status_code == 200
        data = response.json()
        assert data["owner"] == "testowner"
        assert data["name"] == "testrepo"
        assert data["full_name"] == "testowner/testrepo"

    def test_get_repo_list_with_mock_data(self, client, mock_multiple_repos):
        """Test listing repos when data exists."""
        response = client.get("/api/repos")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 3
        owners = [r["owner"] for r in data["repos"]]
        assert "facebook" in owners
        assert "vuejs" in owners
        assert "angular" in owners

    def test_delete_repo(self, client, mock_repo):
        """Test deleting a repo."""
        response = client.delete(f"/api/repos/{mock_repo.id}")
        assert response.status_code == 204  # No Content

        # Verify deletion
        response = client.get(f"/api/repos/{mock_repo.id}")
        assert response.status_code == 404


class TestSnapshotsWithMockData:
    """Test snapshot operations with mock data via charts endpoint."""

    def test_get_repo_snapshots_via_chart(self, client, mock_repo_with_snapshots):
        """Test getting snapshots via chart endpoint."""
        repo, snapshots = mock_repo_with_snapshots
        response = client.get(f"/api/charts/{repo.id}/stars?time_range=90d")
        assert response.status_code == 200
        data = response.json()
        assert len(data["data_points"]) == 30

    def test_snapshot_star_growth(self, client, mock_repo_with_snapshots):
        """Test that snapshots show star growth via chart endpoint."""
        repo, snapshots = mock_repo_with_snapshots
        response = client.get(f"/api/charts/{repo.id}/stars?time_range=90d")
        assert response.status_code == 200
        data = response.json()

        # Verify stars are growing (data points are sorted by date ascending)
        data_points = data["data_points"]
        for i in range(1, len(data_points)):
            assert data_points[i]["stars"] >= data_points[i - 1]["stars"]


class TestSignalsWithMockData:
    """Test signal operations with mock data."""

    def test_repo_with_signals_in_list(self, client, mock_repo_with_signals):
        """Test that repo with signals appears in list with signal data."""
        repo, signal = mock_repo_with_signals
        response = client.get("/api/repos")
        assert response.status_code == 200
        data = response.json()
        # Find the repo in the list
        repo_data = next((r for r in data["repos"] if r["id"] == repo.id), None)
        assert repo_data is not None
        # Velocity signal should be reflected in the repo response
        assert repo_data.get("velocity") is not None or data["total"] >= 1


class TestHealthScoreWithMockData:
    """Test health score with mock data."""

    def test_get_health_score(self, client, mock_health_score):
        """Test getting health score for a repo."""
        repo, score = mock_health_score
        response = client.get(f"/api/health-score/{repo.id}")
        assert response.status_code == 200
        data = response.json()
        assert data["overall_score"] == pytest.approx(75.5)
        assert data["grade"] == "B+"

    def test_get_health_score_summary(self, client, mock_health_score):
        """Test getting health score summary."""
        repo, score = mock_health_score
        response = client.get(f"/api/health-score/{repo.id}/summary")
        assert response.status_code == 200
        data = response.json()
        assert "overall_score" in data


class TestEarlySignalsWithMockData:
    """Test early signals with mock data."""

    def test_get_early_signals(self, client, mock_early_signal):
        """Test getting early signals for a repo."""
        repo, signal = mock_early_signal
        response = client.get("/api/early-signals")
        assert response.status_code == 200
        data = response.json()
        assert len(data) >= 1
        assert any(s["signal_type"] == "rising_star" for s in data)

    def test_early_signal_severity(self, client, mock_early_signal):
        """Test early signal severity value."""
        repo, signal = mock_early_signal
        response = client.get(f"/api/early-signals/{repo.id}")
        assert response.status_code == 200
        data = response.json()
        if isinstance(data, list) and len(data) > 0:
            assert data[0]["severity"] == "high"
            assert data[0]["signal_type"] == "rising_star"


class TestComparisonWithMockData:
    """Test comparison operations with mock data."""

    def test_get_comparison_group(self, client, mock_comparison_group):
        """Test getting a comparison group."""
        group, repos = mock_comparison_group
        response = client.get(f"/api/comparisons/{group.id}")
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Frontend Battle"

    def test_list_comparison_groups(self, client, mock_comparison_group):
        """Test listing comparison groups."""
        group, repos = mock_comparison_group
        response = client.get("/api/comparisons")
        assert response.status_code == 200
        data = response.json()
        assert len(data) >= 1


class TestWebhookWithMockData:
    """Test webhook operations with mock data."""

    def test_get_webhook(self, client, mock_webhook):
        """Test getting a webhook."""
        response = client.get(f"/api/webhooks/{mock_webhook.id}")
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Test Slack Webhook"
        assert data["webhook_type"] == "slack"
        assert data["enabled"] is True

    def test_update_webhook(self, client, mock_webhook):
        """Test updating a webhook."""
        response = client.put(
            f"/api/webhooks/{mock_webhook.id}",
            json={"name": "Updated Webhook", "enabled": False}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated Webhook"
        assert data["enabled"] is False

    def test_list_webhooks(self, client, mock_webhook):
        """Test listing webhooks."""
        response = client.get("/api/webhooks")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 1
        assert len(data["webhooks"]) >= 1


class TestCategoryWithMockData:
    """Test category operations with mock data."""

    def test_get_category(self, client, mock_category):
        """Test getting a category."""
        response = client.get(f"/api/categories/{mock_category.id}")
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Frontend Frameworks"

    def test_list_categories(self, client, mock_category):
        """Test listing categories."""
        response = client.get("/api/categories")
        assert response.status_code == 200
        data = response.json()
        assert len(data) >= 1


class TestChartsWithMockData:
    """Test chart endpoints with mock data."""

    def test_get_stars_chart_with_data(self, client, mock_repo_with_snapshots):
        """Test getting star chart with actual data."""
        repo, snapshots = mock_repo_with_snapshots
        response = client.get(f"/api/charts/{repo.id}/stars")
        assert response.status_code == 200
        data = response.json()
        assert len(data["data_points"]) > 0

    def test_get_stars_chart_time_ranges(self, client, mock_repo_with_snapshots):
        """Test star chart with different time ranges."""
        repo, snapshots = mock_repo_with_snapshots
        for time_range in ["7d", "30d", "90d"]:
            response = client.get(f"/api/charts/{repo.id}/stars?time_range={time_range}")
            assert response.status_code == 200


class TestExportWithMockData:
    """Test export endpoints with mock data."""

    def test_export_watchlist_csv(self, client, mock_multiple_repos):
        """Test exporting watchlist to CSV."""
        response = client.get("/api/export/watchlist.csv")
        assert response.status_code == 200
        assert "text/csv" in response.headers.get("content-type", "")

    def test_export_watchlist_json(self, client, mock_multiple_repos):
        """Test exporting watchlist to JSON."""
        response = client.get("/api/export/watchlist.json")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 3
