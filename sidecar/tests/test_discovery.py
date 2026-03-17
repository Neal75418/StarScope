"""
Tests for discovery (GitHub search) endpoints.
"""

from unittest.mock import patch, AsyncMock

from services.github import GitHubRateLimitError, GitHubAPIError


def _make_github_search_result(count=1, total_count=None):
    """Helper to create a mock GitHub search API response."""
    items = []
    for i in range(count):
        items.append({
            "id": 1000 + i,
            "full_name": f"owner{i}/repo{i}",
            "owner": {
                "login": f"owner{i}",
                "avatar_url": f"https://avatars.githubusercontent.com/u/{1000 + i}",
            },
            "name": f"repo{i}",
            "description": f"Description for repo{i}",
            "language": "Python",
            "stargazers_count": 500 + i * 100,
            "forks_count": 50 + i * 10,
            "html_url": f"https://github.com/owner{i}/repo{i}",
            "topics": ["testing"],
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2025-01-01T00:00:00Z",
            "open_issues_count": 10 + i,
            "license": {"spdx_id": "MIT", "name": "MIT License"},
            "archived": False,
        })
    return {
        "items": items,
        "total_count": total_count if total_count is not None else count,
    }


class TestDiscoverySearch:
    """Test cases for GET /api/discovery/search."""

    def test_search_success(self, client):
        """Test successful search returns repos."""
        mock_result = _make_github_search_result(count=2, total_count=2)

        mock_service = AsyncMock()
        mock_service.search_repos = AsyncMock(return_value=mock_result)

        with patch("routers.discovery.get_github_service", return_value=mock_service):
            response = client.get("/api/discovery/search?q=python")

        assert response.status_code == 200
        response_data = response.json()
        # 驗證統一的 API 響應格式
        assert response_data["success"] is True
        assert "data" in response_data
        assert response_data["error"] is None

        data = response_data["data"]
        assert data["total_count"] == 2
        assert len(data["repos"]) == 2
        assert data["page"] == 1
        assert data["per_page"] == 20
        assert data["has_more"] is False

        repo = data["repos"][0]
        assert repo["full_name"] == "owner0/repo0"
        assert repo["stars"] == 500
        assert repo["language"] == "Python"
        assert repo["owner_avatar_url"] == "https://avatars.githubusercontent.com/u/1000"
        assert repo["open_issues_count"] == 10
        assert repo["license_spdx"] == "MIT"
        assert repo["license_name"] == "MIT License"
        assert repo["archived"] is False

    def test_search_missing_query_returns_422(self, client):
        """Test that missing query parameter returns 422."""
        response = client.get("/api/discovery/search")
        assert response.status_code == 422

    def test_search_empty_query_returns_422(self, client):
        """Test that empty query parameter returns 422."""
        response = client.get("/api/discovery/search?q=")
        assert response.status_code == 422

    def test_search_with_filters(self, client):
        """Test search with language, min_stars, and topic filters."""
        mock_result = _make_github_search_result(count=1, total_count=1)

        mock_service = AsyncMock()
        mock_service.search_repos = AsyncMock(return_value=mock_result)

        with patch("routers.discovery.get_github_service", return_value=mock_service):
            response = client.get(
                "/api/discovery/search?q=web&language=Python&min_stars=100&topic=api"
            )

        assert response.status_code == 200
        response_data = response.json()
        assert response_data["success"] is True
        assert "data" in response_data

        # Verify filters were passed to the service
        mock_service.search_repos.assert_called_once_with(
            query="web",
            language="Python",
            min_stars=100,
            max_stars=None,
            topic="api",
            sort="stars",
            order="desc",
            license=None,
            hide_archived=False,
            page=1,
            per_page=20,
        )

    def test_search_pagination(self, client):
        """Test search with pagination parameters."""
        mock_result = _make_github_search_result(count=5, total_count=100)

        mock_service = AsyncMock()
        mock_service.search_repos = AsyncMock(return_value=mock_result)

        with patch("routers.discovery.get_github_service", return_value=mock_service):
            response = client.get(
                "/api/discovery/search?q=test&page=3&per_page=5"
            )

        assert response.status_code == 200
        response_data = response.json()
        assert response_data["success"] is True
        assert "data" in response_data

        data = response_data["data"]
        assert data["page"] == 3
        assert data["per_page"] == 5
        assert data["has_more"] is True

    def test_search_rate_limit_returns_429(self, client):
        """Test that GitHub rate limit error returns 429."""
        mock_service = AsyncMock()
        mock_service.search_repos = AsyncMock(
            side_effect=GitHubRateLimitError("Rate limit exceeded", status_code=429)
        )

        with patch("routers.discovery.get_github_service", return_value=mock_service):
            response = client.get("/api/discovery/search?q=python")

        assert response.status_code == 429
        data = response.json()
        assert "rate limit" in data["detail"].lower()

    def test_search_api_error_returns_502(self, client):
        """Test that GitHub API error returns 502."""
        mock_service = AsyncMock()
        mock_service.search_repos = AsyncMock(
            side_effect=GitHubAPIError("Internal server error", status_code=500)
        )

        with patch("routers.discovery.get_github_service", return_value=mock_service):
            response = client.get("/api/discovery/search?q=python")

        assert response.status_code == 502
        data = response.json()
        assert data["detail"] == "GitHub API request failed. Please try again later."

    def test_search_with_new_filters(self, client):
        """Test search with license, max_stars, order, and hide_archived filters."""
        mock_result = _make_github_search_result(count=1, total_count=1)

        mock_service = AsyncMock()
        mock_service.search_repos = AsyncMock(return_value=mock_result)

        with patch("routers.discovery.get_github_service", return_value=mock_service):
            response = client.get(
                "/api/discovery/search?q=web&license=mit&max_stars=5000"
                "&order=asc&hide_archived=true"
            )

        assert response.status_code == 200
        response_data = response.json()
        assert response_data["success"] is True

        mock_service.search_repos.assert_called_once_with(
            query="web",
            language=None,
            min_stars=None,
            max_stars=5000,
            topic=None,
            sort="stars",
            order="asc",
            license="mit",
            hide_archived=True,
            page=1,
            per_page=20,
        )

    def test_search_repo_without_license(self, client):
        """Test that repos with no license have null license fields."""
        mock_result = _make_github_search_result(count=1)
        # Set license to None for this item
        mock_result["items"][0]["license"] = None

        mock_service = AsyncMock()
        mock_service.search_repos = AsyncMock(return_value=mock_result)

        with patch("routers.discovery.get_github_service", return_value=mock_service):
            response = client.get("/api/discovery/search?q=test")

        assert response.status_code == 200
        repo = response.json()["data"]["repos"][0]
        assert repo["license_spdx"] is None
        assert repo["license_name"] is None

    def test_search_archived_repo(self, client):
        """Test that archived field is correctly mapped."""
        mock_result = _make_github_search_result(count=1)
        mock_result["items"][0]["archived"] = True

        mock_service = AsyncMock()
        mock_service.search_repos = AsyncMock(return_value=mock_result)

        with patch("routers.discovery.get_github_service", return_value=mock_service):
            response = client.get("/api/discovery/search?q=test")

        assert response.status_code == 200
        repo = response.json()["data"]["repos"][0]
        assert repo["archived"] is True
