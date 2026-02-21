"""
Tests for category endpoints.
"""


class TestCategoryEndpoints:
    """Test cases for /api/categories endpoints."""

    def test_list_categories_empty(self, client):
        """Test listing categories when none exist."""
        response = client.get("/api/categories")
        assert response.status_code == 200
        response_data = response.json()
        # 驗證統一的 API 響應格式
        assert response_data["success"] is True
        assert "data" in response_data
        data = response_data["data"]
        assert data["total"] == 0
        assert data["categories"] == []

    def test_get_category_tree_empty(self, client):
        """Test getting category tree when empty."""
        response = client.get("/api/categories/tree")
        assert response.status_code == 200
        response_data = response.json()
        # 驗證統一的 API 響應格式
        assert response_data["success"] is True
        assert "data" in response_data
        data = response_data["data"]
        assert data["total"] == 0
        assert data["tree"] == []

    def test_create_category(self, client):
        """Test creating a category."""
        response = client.post("/api/categories", json={
            "name": "Test Category",
            "description": "A test category",
            "icon": "folder",
            "color": "#ff0000"
        })
        assert response.status_code == 200
        response_data = response.json()
        # 驗證統一的 API 響應格式
        assert response_data["success"] is True
        assert "data" in response_data
        data = response_data["data"]
        assert data["name"] == "Test Category"
        assert data["description"] == "A test category"
        assert "id" in data

    def test_create_category_minimal(self, client):
        """Test creating a category with only name."""
        response = client.post("/api/categories", json={
            "name": "Minimal Category"
        })
        assert response.status_code == 200
        response_data = response.json()
        # 驗證統一的 API 響應格式
        assert response_data["success"] is True
        assert "data" in response_data
        data = response_data["data"]
        assert data["name"] == "Minimal Category"

    def test_create_category_missing_name(self, client):
        """Test creating a category without name fails."""
        response = client.post("/api/categories", json={
            "description": "No name"
        })
        assert response.status_code == 422  # Validation error

    def test_get_category_not_found(self, client):
        """Test getting a nonexistent category."""
        response = client.get("/api/categories/99999")
        assert response.status_code == 404

    def test_delete_category_not_found(self, client):
        """Test deleting a nonexistent category."""
        response = client.delete("/api/categories/99999")
        assert response.status_code == 404

    def test_update_category_not_found(self, client):
        """Test updating a nonexistent category."""
        response = client.put("/api/categories/99999", json={
            "name": "Updated Name"
        })
        assert response.status_code == 404

    def test_get_category_repos_not_found(self, client):
        """Test getting repos from nonexistent category."""
        response = client.get("/api/categories/99999/repos")
        assert response.status_code == 404

    def test_category_with_parent(self, client):
        """Test creating a category with a parent."""
        # Create parent category
        parent_response = client.post("/api/categories", json={
            "name": "Parent Category"
        })
        assert parent_response.status_code == 200
        parent_id = parent_response.json()["data"]["id"]

        # Create child category
        child_response = client.post("/api/categories", json={
            "name": "Child Category",
            "parent_id": parent_id
        })
        assert child_response.status_code == 200
        child_data = child_response.json()["data"]
        assert child_data["parent_id"] == parent_id

    def test_category_tree_structure(self, client):
        """Test that category tree reflects parent-child relationships."""
        # Create parent
        parent_response = client.post("/api/categories", json={
            "name": "Tree Parent"
        })
        parent_id = parent_response.json()["data"]["id"]

        # Create child
        client.post("/api/categories", json={
            "name": "Tree Child",
            "parent_id": parent_id
        })

        # Get tree
        tree_response = client.get("/api/categories/tree")
        assert tree_response.status_code == 200
        tree_data = tree_response.json()["data"]
        tree = tree_data["tree"]

        # Find parent in tree
        parent_node = next((n for n in tree if n["name"] == "Tree Parent"), None)
        assert parent_node is not None
        assert len(parent_node["children"]) > 0
        assert parent_node["children"][0]["name"] == "Tree Child"
