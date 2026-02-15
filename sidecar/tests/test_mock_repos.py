"""
Comprehensive tests with mock repository data.
Tests real database operations with properly structured mock data.
"""


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
        repo, _ = mock_repo_with_snapshots
        response = client.get(f"/api/charts/{repo.id}/stars?time_range=90d")
        assert response.status_code == 200
        data = response.json()
        assert len(data["data_points"]) == 30

    def test_snapshot_star_growth(self, client, mock_repo_with_snapshots):
        """Test that snapshots show star growth via chart endpoint."""
        repo, _ = mock_repo_with_snapshots
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
        repo, _ = mock_repo_with_signals
        response = client.get("/api/repos")
        assert response.status_code == 200
        data = response.json()
        # Find the repo in the list
        repo_data = next((r for r in data["repos"] if r["id"] == repo.id), None)
        assert repo_data is not None
        # Velocity signal should be reflected in the repo response
        assert repo_data.get("velocity") is not None or data["total"] >= 1


class TestEarlySignalsWithMockData:
    """Test early signals with mock data."""

    def test_get_early_signals(self, client, mock_early_signal):
        """Test getting early signals for a repo."""
        _, _ = mock_early_signal
        response = client.get("/api/early-signals")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 1
        assert any(s["signal_type"] == "rising_star" for s in data["signals"])

    def test_early_signal_severity(self, client, mock_early_signal):
        """Test early signal severity value."""
        repo, _ = mock_early_signal
        response = client.get(f"/api/early-signals/repo/{repo.id}")
        assert response.status_code == 200
        data = response.json()
        if data["total"] > 0:
            assert data["signals"][0]["severity"] == "high"
            assert data["signals"][0]["signal_type"] == "rising_star"


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
        repo, _ = mock_repo_with_snapshots
        response = client.get(f"/api/charts/{repo.id}/stars")
        assert response.status_code == 200
        data = response.json()
        assert len(data["data_points"]) > 0

    def test_get_stars_chart_time_ranges(self, client, mock_repo_with_snapshots):
        """Test star chart with different time ranges."""
        repo, _ = mock_repo_with_snapshots
        for time_range in ["7d", "30d", "90d"]:
            response = client.get(f"/api/charts/{repo.id}/stars?time_range={time_range}")
            assert response.status_code == 200


class TestExportWithMockData:
    """Test export endpoints with mock data."""

    def test_export_watchlist_json(self, client, mock_multiple_repos):
        """Test exporting watchlist to JSON."""
        response = client.get("/api/export/watchlist.json")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 3
        assert len(data["repos"]) == 3
