"""
Tests for comparison group endpoints.
"""


class TestComparisonEndpoints:
    """Test cases for /api/comparisons endpoints."""

    def test_list_groups_empty(self, client):
        """Test listing comparison groups when none exist."""
        response = client.get("/api/comparisons")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0
        assert data["groups"] == []

    def test_create_group(self, client):
        """Test creating a comparison group."""
        response = client.post("/api/comparisons", json={
            "name": "Test Group",
            "description": "A test comparison group"
        })
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Test Group"
        assert data["description"] == "A test comparison group"
        assert "id" in data

    def test_create_group_minimal(self, client):
        """Test creating a comparison group with only name."""
        response = client.post("/api/comparisons", json={
            "name": "Minimal Group"
        })
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Minimal Group"

    def test_create_group_missing_name(self, client):
        """Test creating a group without name fails."""
        response = client.post("/api/comparisons", json={
            "description": "No name"
        })
        assert response.status_code == 422  # Validation error

    def test_get_group_not_found(self, client):
        """Test getting a nonexistent group."""
        response = client.get("/api/comparisons/99999")
        assert response.status_code == 404

    def test_delete_group_not_found(self, client):
        """Test deleting a nonexistent group."""
        response = client.delete("/api/comparisons/99999")
        assert response.status_code == 404

    def test_update_group_not_found(self, client):
        """Test updating a nonexistent group."""
        response = client.put("/api/comparisons/99999", json={
            "name": "Updated Name"
        })
        assert response.status_code == 404

    def test_add_repo_to_group_not_found(self, client):
        """Test adding repo to nonexistent group."""
        response = client.post("/api/comparisons/99999/repos/1")
        assert response.status_code == 404

    def test_group_crud_flow(self, client):
        """Test full CRUD flow for comparison groups."""
        # Create
        create_response = client.post("/api/comparisons", json={
            "name": "CRUD Test",
            "description": "Testing CRUD"
        })
        assert create_response.status_code == 200
        group_id = create_response.json()["id"]

        # Read
        get_response = client.get(f"/api/comparisons/{group_id}")
        assert get_response.status_code == 200
        assert get_response.json()["group_name"] == "CRUD Test"

        # Update
        update_response = client.put(f"/api/comparisons/{group_id}", json={
            "name": "Updated CRUD Test"
        })
        assert update_response.status_code == 200
        assert update_response.json()["name"] == "Updated CRUD Test"

        # Delete
        delete_response = client.delete(f"/api/comparisons/{group_id}")
        assert delete_response.status_code == 200

        # Verify deleted
        verify_response = client.get(f"/api/comparisons/{group_id}")
        assert verify_response.status_code == 404
