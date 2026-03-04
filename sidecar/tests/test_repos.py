"""
Tests for repository endpoints.
"""

from unittest.mock import patch, AsyncMock


MOCK_GITHUB_REPO_DATA = {
    "id": 10270250,
    "name": "react",
    "full_name": "facebook/react",
    "description": "A JavaScript library for building UIs",
    "default_branch": "main",
    "language": "JavaScript",
    "stargazers_count": 220000,
    "forks_count": 45000,
    "subscribers_count": 6000,
    "open_issues_count": 1200,
    "created_at": "2013-05-24T16:15:54Z",
}


def _mock_github_service(**repo_overrides):
    """Create a patched GitHub service returning the given repo data.

    Returns a tuple of (patch_context, mock_service) for use with ``with``.
    ``repo_overrides`` are merged into MOCK_GITHUB_REPO_DATA.
    """
    mock_service = AsyncMock()
    mock_service.get_repo.return_value = {**MOCK_GITHUB_REPO_DATA, **repo_overrides}
    return mock_service


class TestReposEndpoints:
    """Test cases for /api/repos endpoints."""

    def test_list_repos_empty(self, client):
        """Test listing repos when database is empty."""
        response = client.get("/api/repos")
        assert response.status_code == 200
        data = response.json()
        # 驗證統一的 API 響應格式
        assert data["success"] is True
        assert data["data"]["repos"] == []
        assert data["data"]["total"] == 0
        assert data["error"] is None

    def test_list_repos_with_data(self, client, mock_repo):
        """Test listing repos returns existing repos."""
        response = client.get("/api/repos")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["total"] == 1
        assert data["data"]["repos"][0]["full_name"] == "testowner/testrepo"

    def test_list_repos_pagination(self, client, mock_multiple_repos):
        """Test listing repos with pagination parameters."""
        response = client.get("/api/repos?page=1&per_page=2")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert len(data["data"]["repos"]) == 2
        assert data["data"]["total"] == 3
        assert data["data"]["page"] == 1
        assert data["data"]["per_page"] == 2
        assert data["data"]["total_pages"] == 2

    def test_list_repos_pagination_page_only_fails(self, client):
        """Test that providing page without per_page raises 400."""
        response = client.get("/api/repos?page=1")
        assert response.status_code == 400
        assert "Both" in response.json()["detail"]

    def test_list_repos_pagination_per_page_only_fails(self, client):
        """Test that providing per_page without page raises 400."""
        response = client.get("/api/repos?per_page=10")
        assert response.status_code == 400
        assert "Both" in response.json()["detail"]

    def test_add_repo_success(self, client):
        """Test adding a new repo with owner+name via mocked GitHub."""
        with patch("routers.repos.get_github_service") as mock_gh:
            mock_gh.return_value = _mock_github_service()

            response = client.post("/api/repos", json={
                "owner": "facebook",
                "name": "react"
            })

        assert response.status_code == 201
        data = response.json()
        assert data["success"] is True
        assert data["data"]["full_name"] == "facebook/react"
        assert data["data"]["language"] == "JavaScript"
        assert data["message"] == "Repository facebook/react added to watchlist"

    def test_add_repo_via_url(self, client):
        """Test adding a new repo via GitHub URL."""
        with patch("routers.repos.get_github_service") as mock_gh:
            mock_gh.return_value = _mock_github_service()

            response = client.post("/api/repos", json={
                "url": "https://github.com/facebook/react"
            })

        assert response.status_code == 201
        data = response.json()
        assert data["data"]["full_name"] == "facebook/react"

    def test_add_repo_duplicate(self, client, mock_repo):
        """Test adding a repo that already exists returns 400."""
        response = client.post("/api/repos", json={
            "owner": "testowner",
            "name": "testrepo"
        })
        assert response.status_code == 400
        assert "already in your watchlist" in response.json()["detail"]

    def test_add_repo_invalid_format(self, client):
        """Test adding repo with invalid format (only name, no owner)."""
        response = client.post("/api/repos", json={"name": "invalid"})
        assert response.status_code == 422  # Pydantic model_validator requires both

    def test_add_repo_missing_fields(self, client):
        """Test adding repo with missing required fields."""
        response = client.post("/api/repos", json={})
        assert response.status_code == 422  # Pydantic model_validator requires owner+name or url

    def test_get_repo_success(self, client, mock_repo):
        """Test getting a single repo by ID."""
        response = client.get(f"/api/repos/{mock_repo.id}")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["full_name"] == "testowner/testrepo"

    def test_delete_repo_success(self, client, mock_repo):
        """Test deleting an existing repo."""
        response = client.delete(f"/api/repos/{mock_repo.id}")
        assert response.status_code == 204

        # Verify repo is gone
        response = client.get(f"/api/repos/{mock_repo.id}")
        assert response.status_code == 404

    def test_delete_nonexistent_repo(self, client):
        """Test deleting a repo that doesn't exist."""
        response = client.delete("/api/repos/99999")
        assert response.status_code == 404

    def test_fetch_repo_success(self, client, mock_repo):
        """Test manually fetching latest data for a repo."""
        with patch("routers.repos.get_github_service") as mock_gh:
            mock_gh.return_value = _mock_github_service(
                full_name="testowner/testrepo", name="testrepo"
            )

            response = client.post(f"/api/repos/{mock_repo.id}/fetch")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "refreshed" in data["message"].lower()

    def test_fetch_nonexistent_repo(self, client):
        """Test fetching data for a repo that doesn't exist."""
        response = client.post("/api/repos/99999/fetch")
        assert response.status_code == 404

    def test_fetch_all_repos_success(self, client, mock_repo):
        """Test batch refresh of all repos."""
        with patch("routers.repos.get_github_service") as mock_gh, \
             patch("routers.repos.fetch_repo_with_retry", new_callable=AsyncMock) as mock_retry:
            mock_service = AsyncMock()
            mock_gh.return_value = mock_service
            mock_retry.return_value = {
                **MOCK_GITHUB_REPO_DATA,
                "full_name": "testowner/testrepo",
                "name": "testrepo",
            }

            response = client.post("/api/repos/fetch-all")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "Refreshed 1" in data["message"]

    def test_fetch_all_repos_partial_failure(self, client, mock_multiple_repos):
        """Test batch refresh with some repos failing (GitHubNotFoundError)."""
        from services.github import GitHubNotFoundError

        call_count = 0

        async def mock_fetch(github, owner, name):
            nonlocal call_count
            call_count += 1
            if call_count == 2:
                raise GitHubNotFoundError(f"{owner}/{name}")
            return {
                **MOCK_GITHUB_REPO_DATA,
                "full_name": f"{owner}/{name}",
                "name": name,
            }

        with patch("routers.repos.get_github_service") as mock_gh, \
             patch("routers.repos.fetch_repo_with_retry", side_effect=mock_fetch):
            mock_gh.return_value = AsyncMock()

            response = client.post("/api/repos/fetch-all")

        assert response.status_code == 200
        data = response.json()
        assert "1 failed" in data["message"]

    def test_fetch_all_repos_api_error(self, client, mock_repo):
        """Test batch refresh with GitHubAPIError."""
        from services.github import GitHubAPIError

        with patch("routers.repos.get_github_service") as mock_gh, \
             patch("routers.repos.fetch_repo_with_retry", new_callable=AsyncMock) as mock_retry:
            mock_gh.return_value = AsyncMock()
            mock_retry.side_effect = GitHubAPIError("Rate limit exceeded")

            response = client.post("/api/repos/fetch-all")

        assert response.status_code == 200
        data = response.json()
        assert "1 failed" in data["message"]


class TestInputValidation:
    """Test input validation for repository endpoints."""

    def test_owner_name_too_long(self, client):
        """Test that overly long owner names are rejected."""
        response = client.post("/api/repos", json={
            "owner": "a" * 100,
            "name": "test"
        })
        assert response.status_code == 422  # Pydantic validation error

    def test_repo_name_too_long(self, client):
        """Test that overly long repo names are rejected."""
        response = client.post("/api/repos", json={
            "owner": "test",
            "name": "a" * 200
        })
        assert response.status_code == 422  # Pydantic validation error

    def test_invalid_owner_format(self, client):
        """Test that invalid owner format is rejected."""
        response = client.post("/api/repos", json={
            "owner": "invalid--owner",  # consecutive hyphens are invalid
            "name": "test"
        })
        assert response.status_code == 422  # Pydantic validation error

    def test_invalid_repo_name_format(self, client):
        """Test that invalid repo name format is rejected."""
        response = client.post("/api/repos", json={
            "owner": "valid",
            "name": "invalid repo name with spaces"
        })
        assert response.status_code == 422  # Pydantic validation error
