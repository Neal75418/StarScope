"""
Tests for health check endpoint.
"""


def test_health_check(client):
    """Test that health check returns OK."""
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    # 驗證統一的 API 響應格式
    assert data["success"] is True
    assert data["data"]["status"] == "ok"
    assert "timestamp" in data["data"]
    assert data["message"] == "Service is healthy"


def test_root_endpoint(client):
    """Test that root endpoint returns message."""
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert "message" in data
    assert "StarScope" in data["message"]
