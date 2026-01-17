"""
Tests for tag endpoints.
"""


class TestTagEndpoints:
    """Test cases for /api/tags endpoints."""

    def test_list_tags_empty(self, client):
        """Test listing tags when none exist."""
        response = client.get("/api/tags")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0
        assert data["tags"] == []

    def test_list_tags_by_type(self, client):
        """Test filtering tags by type."""
        response = client.get("/api/tags?tag_type=language")
        assert response.status_code == 200
        data = response.json()
        assert "tags" in data
        assert "total" in data

    def test_get_repo_tags_not_found(self, client):
        """Test getting tags for nonexistent repo."""
        response = client.get("/api/tags/repo/99999")
        assert response.status_code == 404

    def test_add_tag_to_repo_not_found(self, client):
        """Test adding tag to nonexistent repo."""
        response = client.post("/api/tags/repo/99999", json={
            "name": "test-tag"
        })
        assert response.status_code == 404

    def test_remove_tag_from_repo_not_found(self, client):
        """Test removing tag from nonexistent repo."""
        response = client.delete("/api/tags/repo/99999/1")
        assert response.status_code == 404

    def test_search_by_tags_empty(self, client):
        """Test searching repos by tags with no results."""
        response = client.get("/api/tags/search?tags=nonexistent-tag")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0
        assert data["repos"] == []

    def test_search_by_multiple_tags(self, client):
        """Test searching repos by multiple tags."""
        response = client.get("/api/tags/search?tags=tag1,tag2&match_all=true")
        assert response.status_code == 200
        data = response.json()
        assert "repos" in data
        assert "total" in data

    def test_auto_tag_repo_not_found(self, client):
        """Test auto-tagging nonexistent repo."""
        response = client.post("/api/tags/repo/99999/auto-tag")
        assert response.status_code == 404

    def test_auto_tag_all(self, client):
        """Test auto-tagging all repos."""
        response = client.post("/api/tags/auto-tag-all")
        assert response.status_code == 200
        data = response.json()
        assert "total_repos" in data
        assert "repos_tagged" in data
        assert "tags_applied" in data
