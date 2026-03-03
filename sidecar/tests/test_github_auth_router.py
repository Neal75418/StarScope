"""
Tests for GitHub auth router endpoints.
"""

from unittest.mock import patch, AsyncMock, MagicMock
from dataclasses import dataclass
from typing import Optional


@dataclass
class MockDeviceCodeResponse:
    device_code: str = "dc_test123"
    user_code: str = "ABCD-1234"
    verification_uri: str = "https://github.com/login/device"
    expires_in: int = 900
    interval: int = 5


@dataclass
class MockConnectionStatus:
    connected: bool = True
    username: Optional[str] = "testuser"
    rate_limit_remaining: Optional[int] = 4900
    rate_limit_total: Optional[int] = 5000
    rate_limit_reset: Optional[int] = 1700000000
    error: Optional[str] = None


class TestDeviceFlow:
    """Test cases for /api/github-auth/device-code endpoint."""

    def test_initiate_device_flow_success(self, client):
        """Test successful device flow initiation."""
        with patch("routers.github_auth.get_github_auth_service") as mock_get:
            mock_service = AsyncMock()
            mock_service.initiate_device_flow.return_value = MockDeviceCodeResponse()
            mock_get.return_value = mock_service

            response = client.post("/api/github-auth/device-code")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["device_code"] == "dc_test123"
        assert data["data"]["user_code"] == "ABCD-1234"
        assert data["data"]["verification_uri"] == "https://github.com/login/device"
        assert data["data"]["expires_in"] == 900
        assert data["data"]["interval"] == 5

    def test_initiate_device_flow_auth_error(self, client):
        """Test device flow initiation with GitHubAuthError."""
        from services.github_auth import GitHubAuthError

        with patch("routers.github_auth.get_github_auth_service") as mock_get:
            mock_service = AsyncMock()
            mock_service.initiate_device_flow.side_effect = GitHubAuthError("Client ID not configured")
            mock_get.return_value = mock_service

            response = client.post("/api/github-auth/device-code")

        assert response.status_code == 400
        assert "Client ID not configured" in response.json()["detail"]


class TestPollAuthorization:
    """Test cases for /api/github-auth/poll endpoint."""

    def test_poll_pending(self, client):
        """Test polling when authorization is pending."""
        with patch("routers.github_auth.get_github_auth_service") as mock_get:
            mock_service = AsyncMock()
            mock_service.poll_for_token.return_value = {"status": "pending"}
            mock_get.return_value = mock_service

            response = client.post("/api/github-auth/poll", json={
                "device_code": "dc_test123"
            })

        assert response.status_code == 200
        data = response.json()
        assert data["data"]["status"] == "pending"
        assert data["data"]["username"] is None

    def test_poll_success(self, client):
        """Test polling when authorization succeeds."""
        with patch("routers.github_auth.get_github_auth_service") as mock_get:
            mock_service = AsyncMock()
            mock_service.poll_for_token.return_value = {
                "status": "success",
                "username": "testuser",
            }
            mock_get.return_value = mock_service

            response = client.post("/api/github-auth/poll", json={
                "device_code": "dc_test123"
            })

        assert response.status_code == 200
        data = response.json()
        assert data["data"]["status"] == "success"
        assert data["data"]["username"] == "testuser"

    def test_poll_expired(self, client):
        """Test polling when device code has expired."""
        with patch("routers.github_auth.get_github_auth_service") as mock_get:
            mock_service = AsyncMock()
            mock_service.poll_for_token.return_value = {
                "status": "expired",
                "error": "The device code has expired",
            }
            mock_get.return_value = mock_service

            response = client.post("/api/github-auth/poll", json={
                "device_code": "dc_expired"
            })

        assert response.status_code == 200
        data = response.json()
        assert data["data"]["status"] == "expired"
        assert data["data"]["error"] == "The device code has expired"

    def test_poll_slow_down(self, client):
        """Test polling when server requests slow down."""
        with patch("routers.github_auth.get_github_auth_service") as mock_get:
            mock_service = AsyncMock()
            mock_service.poll_for_token.return_value = {
                "status": "pending",
                "slow_down": True,
                "interval": 10,
            }
            mock_get.return_value = mock_service

            response = client.post("/api/github-auth/poll", json={
                "device_code": "dc_test123"
            })

        assert response.status_code == 200
        data = response.json()
        assert data["data"]["slow_down"] is True
        assert data["data"]["interval"] == 10


class TestConnectionStatus:
    """Test cases for /api/github-auth/status endpoint."""

    def test_get_status_connected(self, client):
        """Test getting connection status when connected."""
        with patch("routers.github_auth.get_github_auth_service") as mock_get:
            mock_service = AsyncMock()
            mock_service.get_connection_status.return_value = MockConnectionStatus()
            mock_get.return_value = mock_service

            response = client.get("/api/github-auth/status")

        assert response.status_code == 200
        data = response.json()
        assert data["data"]["connected"] is True
        assert data["data"]["username"] == "testuser"
        assert data["data"]["rate_limit_remaining"] == 4900
        assert data["data"]["rate_limit_total"] == 5000

    def test_get_status_disconnected(self, client):
        """Test getting connection status when disconnected."""
        with patch("routers.github_auth.get_github_auth_service") as mock_get:
            mock_service = AsyncMock()
            mock_service.get_connection_status.return_value = MockConnectionStatus(
                connected=False, username=None,
                rate_limit_remaining=None, rate_limit_total=None,
                rate_limit_reset=None,
            )
            mock_get.return_value = mock_service

            response = client.get("/api/github-auth/status")

        assert response.status_code == 200
        data = response.json()
        assert data["data"]["connected"] is False
        assert data["data"]["username"] is None


class TestDisconnect:
    """Test cases for /api/github-auth/disconnect endpoint."""

    def test_disconnect_when_connected(self, client):
        """Test disconnecting when currently connected."""
        with patch("routers.github_auth.get_github_auth_service") as mock_get:
            mock_service = MagicMock()
            mock_service.disconnect.return_value = True
            mock_get.return_value = mock_service

            response = client.post("/api/github-auth/disconnect")

        assert response.status_code == 200
        data = response.json()
        assert data["data"]["success"] is True
        assert "Successfully disconnected" in data["data"]["message"]

    def test_disconnect_when_not_connected(self, client):
        """Test disconnecting when not connected."""
        with patch("routers.github_auth.get_github_auth_service") as mock_get:
            mock_service = MagicMock()
            mock_service.disconnect.return_value = False
            mock_get.return_value = mock_service

            response = client.post("/api/github-auth/disconnect")

        assert response.status_code == 200
        data = response.json()
        assert data["data"]["success"] is True
        assert "No GitHub connection" in data["data"]["message"]
