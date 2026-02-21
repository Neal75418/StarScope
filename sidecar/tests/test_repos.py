"""
Tests for repository endpoints.
"""

class TestReposEndpoints:
    """Test cases for /api/repos endpoints."""

    def test_list_repos_empty(self, client):
        """Test listing repos when database is empty."""
        response = client.get("/api/repos")
        assert response.status_code == 200
        data = response.json()
        # 驗證統一的 API 響應格式
        assert data["success"] is True
        assert data["data"] == []
        assert data["error"] is None

    def test_add_repo_invalid_format(self, client):
        """Test adding repo with invalid format (only name, no owner)."""
        response = client.post("/api/repos", json={"name": "invalid"})
        assert response.status_code == 422  # Pydantic model_validator requires both

    def test_add_repo_missing_fields(self, client):
        """Test adding repo with missing required fields."""
        response = client.post("/api/repos", json={})
        assert response.status_code == 422  # Pydantic model_validator requires owner+name or url

    def test_delete_nonexistent_repo(self, client):
        """Test deleting a repo that doesn't exist."""
        response = client.delete("/api/repos/99999")
        assert response.status_code == 404

    def test_fetch_nonexistent_repo(self, client):
        """Test fetching data for a repo that doesn't exist."""
        response = client.post("/api/repos/99999/fetch")
        assert response.status_code == 404


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
