"""
Tests for category endpoints.
"""

# ID guaranteed not to exist in the test database
NONEXISTENT_CATEGORY_ID = 99999


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
        response = client.get(f"/api/categories/{NONEXISTENT_CATEGORY_ID}")
        assert response.status_code == 404

    def test_delete_category_not_found(self, client):
        """Test deleting a nonexistent category."""
        response = client.delete(f"/api/categories/{NONEXISTENT_CATEGORY_ID}")
        assert response.status_code == 404

    def test_update_category_not_found(self, client):
        """Test updating a nonexistent category."""
        response = client.put(f"/api/categories/{NONEXISTENT_CATEGORY_ID}", json={
            "name": "Updated Name"
        })
        assert response.status_code == 404

    def test_get_category_repos_not_found(self, client):
        """Test getting repos from nonexistent category."""
        response = client.get(f"/api/categories/{NONEXISTENT_CATEGORY_ID}/repos")
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


class TestCategoryUpdate:
    """Test cases for category update operations."""

    def test_update_category_name(self, client, mock_category):
        """Test updating a category's name."""
        response = client.put(f"/api/categories/{mock_category.id}", json={
            "name": "Updated Name"
        })
        assert response.status_code == 200
        assert response.json()["data"]["name"] == "Updated Name"

    def test_update_category_partial_fields(self, client, mock_category):
        """Test updating only specific fields via model_fields_set."""
        response = client.put(f"/api/categories/{mock_category.id}", json={
            "icon": "star",
            "color": "#00ff00"
        })
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["icon"] == "star"
        assert data["color"] == "#00ff00"
        # Name should remain unchanged
        assert data["name"] == "Frontend Frameworks"

    def test_update_category_parent(self, client):
        """Test updating a category's parent_id."""
        # Create two categories
        parent = client.post("/api/categories", json={"name": "Parent"}).json()["data"]
        child = client.post("/api/categories", json={"name": "Child"}).json()["data"]

        response = client.put(f"/api/categories/{child['id']}", json={
            "parent_id": parent["id"]
        })
        assert response.status_code == 200
        assert response.json()["data"]["parent_id"] == parent["id"]

    def test_update_category_circular_reference(self, client):
        """Test that circular parent references are rejected."""
        parent = client.post("/api/categories", json={"name": "A"}).json()["data"]
        child = client.post("/api/categories", json={
            "name": "B", "parent_id": parent["id"]
        }).json()["data"]

        # Try to make A's parent be B (circular: A -> B -> A)
        response = client.put(f"/api/categories/{parent['id']}", json={
            "parent_id": child["id"]
        })
        assert response.status_code == 400
        assert "Circular reference" in response.json()["detail"]

    def test_update_category_indirect_circular_reference(self, client):
        """Test that indirect circular references (A->B->C->A) are detected."""
        a = client.post("/api/categories", json={"name": "A"}).json()["data"]
        b = client.post("/api/categories", json={
            "name": "B", "parent_id": a["id"]
        }).json()["data"]
        c = client.post("/api/categories", json={
            "name": "C", "parent_id": b["id"]
        }).json()["data"]

        # Try to make A's parent be C (circular: A -> B -> C -> A)
        response = client.put(f"/api/categories/{a['id']}", json={
            "parent_id": c["id"]
        })
        assert response.status_code == 400
        assert "Circular reference" in response.json()["detail"]

    def test_update_category_nonexistent_parent(self, client, mock_category):
        """Test updating parent_id to a nonexistent category."""
        response = client.put(f"/api/categories/{mock_category.id}", json={
            "parent_id": NONEXISTENT_CATEGORY_ID
        })
        assert response.status_code == 404
        assert "Parent category not found" in response.json()["detail"]


class TestCategoryDelete:
    """Test cases for category deletion."""

    def test_delete_category_success(self, client, mock_category):
        """Test deleting an existing category."""
        response = client.delete(f"/api/categories/{mock_category.id}")
        assert response.status_code == 200
        assert response.json()["data"]["status"] == "ok"

        # Verify category is gone
        response = client.get(f"/api/categories/{mock_category.id}")
        assert response.status_code == 404


class TestCategoryRepoOperations:
    """Test cases for repo-category association operations."""

    def test_add_repo_to_category(self, client, mock_category, mock_repo):
        """Test adding a repo to a category."""
        response = client.post(
            f"/api/categories/{mock_category.id}/repos/{mock_repo.id}"
        )
        assert response.status_code == 200
        assert response.json()["data"]["status"] == "ok"

    def test_add_repo_to_category_duplicate(self, client, mock_category, mock_repo):
        """Test adding same repo again returns 409."""
        client.post(f"/api/categories/{mock_category.id}/repos/{mock_repo.id}")

        response = client.post(
            f"/api/categories/{mock_category.id}/repos/{mock_repo.id}"
        )
        assert response.status_code == 409
        assert "already in category" in response.json()["detail"]

    def test_remove_repo_from_category(self, client, mock_category, mock_repo):
        """Test removing a repo from a category."""
        client.post(f"/api/categories/{mock_category.id}/repos/{mock_repo.id}")

        response = client.delete(
            f"/api/categories/{mock_category.id}/repos/{mock_repo.id}"
        )
        assert response.status_code == 200

    def test_remove_repo_not_in_category(self, client, mock_category, mock_repo):
        """Test removing a repo that isn't in the category returns 404."""
        response = client.delete(
            f"/api/categories/{mock_category.id}/repos/{mock_repo.id}"
        )
        assert response.status_code == 404
        assert "not in this category" in response.json()["detail"]

    def test_get_category_repos(self, client, mock_category, mock_repo):
        """Test listing repos in a category."""
        client.post(f"/api/categories/{mock_category.id}/repos/{mock_repo.id}")

        response = client.get(f"/api/categories/{mock_category.id}/repos")
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total"] == 1
        assert data["repos"][0]["full_name"] == "testowner/testrepo"

    def test_get_category_repos_empty(self, client, mock_category):
        """Test listing repos in an empty category."""
        response = client.get(f"/api/categories/{mock_category.id}/repos")
        assert response.status_code == 200
        assert response.json()["data"]["total"] == 0

    def test_get_repo_categories(self, client, mock_category, mock_repo):
        """Test getting all categories a repo belongs to."""
        client.post(f"/api/categories/{mock_category.id}/repos/{mock_repo.id}")

        response = client.get(f"/api/categories/repo/{mock_repo.id}/categories")
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["repo_id"] == mock_repo.id
        assert data["total"] == 1
        assert data["categories"][0]["name"] == "Frontend Frameworks"

    def test_get_repo_categories_none(self, client, mock_repo):
        """Test getting categories when repo belongs to none."""
        response = client.get(f"/api/categories/repo/{mock_repo.id}/categories")
        assert response.status_code == 200
        assert response.json()["data"]["total"] == 0
