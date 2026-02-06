"""
Tests for commit activity endpoints.
"""

from datetime import date, datetime, timezone
from unittest.mock import patch, AsyncMock

from db.models import CommitActivity
from utils.time import utc_now


def _create_commit_activities(test_db, repo_id, weeks=4):
    """Helper to create CommitActivity records in the database."""
    activities = []
    now = utc_now()
    for i in range(weeks):
        # Create weeks starting from a fixed base date
        week_start = date(2025, 1, 5 + i * 7)  # Sundays
        activity = CommitActivity(
            repo_id=repo_id,
            week_start=week_start,
            commit_count=10 + i * 5,
            fetched_at=now,
        )
        test_db.add(activity)
        activities.append(activity)
    test_db.commit()
    for a in activities:
        test_db.refresh(a)
    return activities


class TestGetCommitActivity:
    """Test cases for GET /api/commit-activity/{repo_id}."""

    def test_get_commit_activity_has_data(self, client, test_db, mock_repo):
        """Test getting commit activity with existing data."""
        activities = _create_commit_activities(test_db, mock_repo.id, weeks=4)

        response = client.get(f"/api/commit-activity/{mock_repo.id}")
        assert response.status_code == 200
        data = response.json()
        assert data["repo_id"] == mock_repo.id
        assert data["repo_name"] == mock_repo.full_name
        assert len(data["weeks"]) == 4
        assert data["total_commits_52w"] == sum(a.commit_count for a in activities)
        assert data["avg_commits_per_week"] > 0
        assert data["last_updated"] is not None

        # Verify weeks are sorted by date
        week_dates = [w["week_start"] for w in data["weeks"]]
        assert week_dates == sorted(week_dates)

    def test_get_commit_activity_empty(self, client, mock_repo):
        """Test getting commit activity when not fetched yet returns 404."""
        response = client.get(f"/api/commit-activity/{mock_repo.id}")
        assert response.status_code == 404
        data = response.json()
        assert "not fetched yet" in data["detail"].lower()

    def test_get_commit_activity_repo_not_found(self, client):
        """Test getting commit activity for nonexistent repo returns 404."""
        response = client.get("/api/commit-activity/99999")
        assert response.status_code == 404


class TestGetCommitActivitySummary:
    """Test cases for GET /api/commit-activity/{repo_id}/summary."""

    def test_get_summary_has_data(self, client, test_db, mock_repo):
        """Test getting commit activity summary with data."""
        activities = _create_commit_activities(test_db, mock_repo.id, weeks=4)
        total = sum(a.commit_count for a in activities)

        response = client.get(f"/api/commit-activity/{mock_repo.id}/summary")
        assert response.status_code == 200
        data = response.json()
        assert data["repo_id"] == mock_repo.id
        assert data["total_commits_52w"] == total
        assert data["avg_commits_per_week"] == round(total / 4, 2)
        assert data["last_updated"] is not None

    def test_get_summary_not_fetched(self, client, mock_repo):
        """Test getting summary when not fetched yet returns 404."""
        response = client.get(f"/api/commit-activity/{mock_repo.id}/summary")
        assert response.status_code == 404

    def test_get_summary_repo_not_found(self, client):
        """Test getting summary for nonexistent repo returns 404."""
        response = client.get("/api/commit-activity/99999/summary")
        assert response.status_code == 404


class TestFetchCommitActivity:
    """Test cases for POST /api/commit-activity/{repo_id}/fetch."""

    def test_fetch_success(self, client, mock_repo):
        """Test fetching commit activity from GitHub."""
        # Mock GitHub API response: list of week objects
        mock_github_data = [
            {"week": 1735689600, "total": 15, "days": [1, 2, 3, 4, 2, 1, 2]},  # 2025-01-01
            {"week": 1736294400, "total": 22, "days": [3, 4, 5, 3, 2, 3, 2]},  # 2025-01-08
        ]

        mock_service = AsyncMock()
        mock_service.get_commit_activity = AsyncMock(return_value=mock_github_data)

        with patch("routers.commit_activity.get_github_service", return_value=mock_service):
            response = client.post(f"/api/commit-activity/{mock_repo.id}/fetch")

        assert response.status_code == 200
        data = response.json()
        assert data["repo_id"] == mock_repo.id
        assert data["repo_name"] == mock_repo.full_name
        assert len(data["weeks"]) == 2
        assert data["total_commits_52w"] == 37

    def test_fetch_empty_github_data(self, client, mock_repo):
        """Test fetching when GitHub returns empty data (new repo)."""
        mock_service = AsyncMock()
        mock_service.get_commit_activity = AsyncMock(return_value=[])

        with patch("routers.commit_activity.get_github_service", return_value=mock_service):
            response = client.post(f"/api/commit-activity/{mock_repo.id}/fetch")

        assert response.status_code == 200
        data = response.json()
        assert data["repo_id"] == mock_repo.id
        assert data["weeks"] == []
        assert data["total_commits_52w"] == 0
        assert data["avg_commits_per_week"] == 0.0

    def test_fetch_repo_not_found(self, client):
        """Test fetching commit activity for nonexistent repo returns 404."""
        response = client.post("/api/commit-activity/99999/fetch")
        assert response.status_code == 404
