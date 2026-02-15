"""
Tests for star history endpoints.
"""

from datetime import timedelta
from unittest.mock import patch, AsyncMock

from db.models import RepoSnapshot
from utils.time import utc_now


class TestStarHistoryStatus:
    """Test cases for GET /api/star-history/{repo_id}/status."""

    def test_get_status_valid_repo(self, client, mock_repo_with_snapshots):
        """Test getting backfill status for a valid repo with snapshots."""
        repo, snapshots = mock_repo_with_snapshots
        response = client.get(f"/api/star-history/{repo.id}/status")
        assert response.status_code == 200
        data = response.json()
        assert data["repo_id"] == repo.id
        assert data["repo_name"] == repo.full_name
        assert data["max_stars_allowed"] == 5000
        assert data["can_backfill"] is True
        assert data["current_stars"] == snapshots[-1].stars
        assert data["has_backfilled_data"] is True
        assert data["backfilled_days"] == len(snapshots)

    def test_get_status_repo_not_found(self, client):
        """Test getting backfill status for a nonexistent repo returns 404."""
        response = client.get("/api/star-history/99999/status")
        assert response.status_code == 404

    def test_get_status_can_backfill_low_stars(self, client, test_db, mock_repo):
        """Test that a repo with low stars is eligible for backfill."""
        snapshot = RepoSnapshot(
            repo_id=mock_repo.id,
            stars=100,
            forks=10,
            watchers=5,
            open_issues=0,
            snapshot_date=utc_now().date(),
            fetched_at=utc_now(),
        )
        test_db.add(snapshot)
        test_db.commit()

        response = client.get(f"/api/star-history/{mock_repo.id}/status")
        assert response.status_code == 200
        data = response.json()
        assert data["can_backfill"] is True
        assert data["current_stars"] == 100
        assert "eligible" in data["message"].lower()

    def test_get_status_cannot_backfill_too_many_stars(self, client, test_db, mock_repo):
        """Test that a repo with >5000 stars is not eligible for backfill."""
        snapshot = RepoSnapshot(
            repo_id=mock_repo.id,
            stars=6000,
            forks=500,
            watchers=200,
            open_issues=50,
            snapshot_date=utc_now().date(),
            fetched_at=utc_now(),
        )
        test_db.add(snapshot)
        test_db.commit()

        response = client.get(f"/api/star-history/{mock_repo.id}/status")
        assert response.status_code == 200
        data = response.json()
        assert data["can_backfill"] is False
        assert data["current_stars"] == 6000


class TestStarHistoryBackfill:
    """Test cases for POST /api/star-history/{repo_id}/backfill."""

    def test_backfill_success(self, client, mock_repo):
        """Test successful backfill with stargazer data."""
        mock_stargazers = [
            {"starred_at": "2025-01-01T10:00:00Z", "user": {"login": "user1"}},
            {"starred_at": "2025-01-02T12:00:00Z", "user": {"login": "user2"}},
            {"starred_at": "2025-01-02T14:00:00Z", "user": {"login": "user3"}},
        ]

        mock_service = AsyncMock()
        mock_service.get_stargazers_with_dates = AsyncMock(return_value=mock_stargazers)

        with patch("routers.star_history.get_github_service", return_value=mock_service):
            response = client.post(f"/api/star-history/{mock_repo.id}/backfill")

        assert response.status_code == 200
        data = response.json()
        assert data["repo_id"] == mock_repo.id
        assert data["success"] is True
        assert data["total_stargazers"] == 3
        assert data["snapshots_created"] > 0
        assert data["earliest_date"] == "2025-01-01"
        assert data["latest_date"] == "2025-01-02"

    def test_backfill_repo_not_found(self, client):
        """Test backfill for a nonexistent repo returns 404."""
        response = client.post("/api/star-history/99999/backfill")
        assert response.status_code == 404

    def test_backfill_too_many_stars(self, client, test_db, mock_repo):
        """Test backfill returns failure when repo has too many stars and no stargazers returned."""
        # Create snapshot with >5000 stars
        snapshot = RepoSnapshot(
            repo_id=mock_repo.id,
            stars=6000,
            forks=500,
            watchers=200,
            open_issues=50,
            snapshot_date=utc_now().date(),
            fetched_at=utc_now(),
        )
        test_db.add(snapshot)
        test_db.commit()

        mock_service = AsyncMock()
        mock_service.get_stargazers_with_dates = AsyncMock(return_value=[])

        with patch("routers.star_history.get_github_service", return_value=mock_service):
            response = client.post(f"/api/star-history/{mock_repo.id}/backfill")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert "too many stars" in data["message"].lower()


class TestStarHistoryGet:
    """Test cases for GET /api/star-history/{repo_id}."""

    def test_get_history_with_data(self, client, mock_repo_with_snapshots):
        """Test getting star history for a repo with snapshots."""
        repo, snapshots = mock_repo_with_snapshots
        response = client.get(f"/api/star-history/{repo.id}")
        assert response.status_code == 200
        data = response.json()
        assert data["repo_id"] == repo.id
        assert data["repo_name"] == repo.full_name
        assert data["total_points"] == len(snapshots)
        assert len(data["history"]) == len(snapshots)
        # Verify sorting by date ascending
        dates = [point["date"] for point in data["history"]]
        assert dates == sorted(dates)

    def test_get_history_empty(self, client, mock_repo):
        """Test getting star history for a repo with no snapshots."""
        response = client.get(f"/api/star-history/{mock_repo.id}")
        assert response.status_code == 200
        data = response.json()
        assert data["repo_id"] == mock_repo.id
        assert data["history"] == []
        assert data["total_points"] == 0
        assert data["is_backfilled"] is False

    def test_get_history_is_backfilled(self, client, test_db, mock_repo):
        """Test that is_backfilled is True when data spans >30 days."""
        today = utc_now().date()
        # Create snapshots spanning 60 days
        for i in range(60, 0, -10):
            snapshot = RepoSnapshot(
                repo_id=mock_repo.id,
                stars=100 + (60 - i),
                forks=0,
                watchers=0,
                open_issues=0,
                snapshot_date=today - timedelta(days=i),
                fetched_at=utc_now(),
            )
            test_db.add(snapshot)
        test_db.commit()

        response = client.get(f"/api/star-history/{mock_repo.id}")
        assert response.status_code == 200
        data = response.json()
        assert data["is_backfilled"] is True

    def test_get_history_repo_not_found(self, client):
        """Test getting star history for a nonexistent repo returns 404."""
        response = client.get("/api/star-history/99999")
        assert response.status_code == 404
