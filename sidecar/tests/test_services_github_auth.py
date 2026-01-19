"""
Tests for services/github_auth.py - GitHub Device Flow authentication service.
"""

import pytest
import os
from unittest.mock import patch, MagicMock, AsyncMock

import httpx

from services.github_auth import (
    GitHubAuthService,
    GitHubAuthError,
    DeviceCodeResponse,
    ConnectionStatus,
    get_github_auth_service,
)


class TestGitHubAuthServiceInit:
    """Tests for GitHubAuthService initialization."""

    def test_reads_client_id_from_env(self):
        """Test reads client ID from environment."""
        with patch.dict(os.environ, {"GITHUB_CLIENT_ID": "test-client-id"}):
            service = GitHubAuthService()
            assert service.client_id == "test-client-id"

    def test_handles_missing_client_id(self):
        """Test handles missing client ID gracefully."""
        env = os.environ.copy()
        env.pop("GITHUB_CLIENT_ID", None)

        with patch.dict(os.environ, env, clear=True):
            service = GitHubAuthService()
            assert service.client_id is None


class TestInitiateDeviceFlow:
    """Tests for initiate_device_flow method."""

    @pytest.mark.asyncio
    async def test_raises_without_client_id(self):
        """Test raises error when client ID not configured."""
        with patch.dict(os.environ, {}, clear=True):
            service = GitHubAuthService()

            with pytest.raises(GitHubAuthError, match="Client ID not configured"):
                await service.initiate_device_flow()

    @pytest.mark.asyncio
    async def test_successful_initiation(self):
        """Test successful device flow initiation."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "device_code": "dc123",
            "user_code": "ABCD-1234",
            "verification_uri": "https://github.com/login/device",
            "expires_in": 900,
            "interval": 5,
        }

        with patch.dict(os.environ, {"GITHUB_CLIENT_ID": "test-id"}):
            with patch('httpx.AsyncClient') as mock_client_class:
                mock_client = AsyncMock()
                mock_client.post.return_value = mock_response
                mock_client_class.return_value.__aenter__.return_value = mock_client

                service = GitHubAuthService()
                result = await service.initiate_device_flow()

                assert isinstance(result, DeviceCodeResponse)
                assert result.device_code == "dc123"
                assert result.user_code == "ABCD-1234"
                assert result.expires_in == 900

    @pytest.mark.asyncio
    async def test_raises_on_error_response(self):
        """Test raises error on non-200 response."""
        mock_response = MagicMock()
        mock_response.status_code = 400
        mock_response.text = "Bad request"

        with patch.dict(os.environ, {"GITHUB_CLIENT_ID": "test-id"}):
            with patch('httpx.AsyncClient') as mock_client_class:
                mock_client = AsyncMock()
                mock_client.post.return_value = mock_response
                mock_client_class.return_value.__aenter__.return_value = mock_client

                service = GitHubAuthService()

                with pytest.raises(GitHubAuthError):
                    await service.initiate_device_flow()


class TestPollForToken:
    """Tests for poll_for_token method."""

    @pytest.mark.asyncio
    async def test_returns_error_without_client_id(self):
        """Test returns error when client ID not configured."""
        with patch.dict(os.environ, {}, clear=True):
            service = GitHubAuthService()
            result = await service.poll_for_token("device_code")

            assert result["status"] == "error"
            assert "Client ID" in result["error"]

    @pytest.mark.asyncio
    async def test_returns_pending_on_authorization_pending(self):
        """Test returns pending status when authorization pending."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"error": "authorization_pending"}

        with patch.dict(os.environ, {"GITHUB_CLIENT_ID": "test-id"}):
            with patch('httpx.AsyncClient') as mock_client_class:
                mock_client = AsyncMock()
                mock_client.post.return_value = mock_response
                mock_client_class.return_value.__aenter__.return_value = mock_client

                service = GitHubAuthService()
                result = await service.poll_for_token("device_code")

                assert result["status"] == "pending"

    @pytest.mark.asyncio
    async def test_returns_slow_down(self):
        """Test returns slow_down flag when rate limited."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"error": "slow_down", "interval": 10}

        with patch.dict(os.environ, {"GITHUB_CLIENT_ID": "test-id"}):
            with patch('httpx.AsyncClient') as mock_client_class:
                mock_client = AsyncMock()
                mock_client.post.return_value = mock_response
                mock_client_class.return_value.__aenter__.return_value = mock_client

                service = GitHubAuthService()
                result = await service.poll_for_token("device_code")

                assert result["status"] == "pending"
                assert result["slow_down"] is True
                assert result["interval"] == 10

    @pytest.mark.asyncio
    async def test_returns_expired(self):
        """Test returns expired status when device code expired."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"error": "expired_token"}

        with patch.dict(os.environ, {"GITHUB_CLIENT_ID": "test-id"}):
            with patch('httpx.AsyncClient') as mock_client_class:
                mock_client = AsyncMock()
                mock_client.post.return_value = mock_response
                mock_client_class.return_value.__aenter__.return_value = mock_client

                service = GitHubAuthService()
                result = await service.poll_for_token("device_code")

                assert result["status"] == "expired"

    @pytest.mark.asyncio
    async def test_returns_error_on_access_denied(self):
        """Test returns error when user denies access."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"error": "access_denied"}

        with patch.dict(os.environ, {"GITHUB_CLIENT_ID": "test-id"}):
            with patch('httpx.AsyncClient') as mock_client_class:
                mock_client = AsyncMock()
                mock_client.post.return_value = mock_response
                mock_client_class.return_value.__aenter__.return_value = mock_client

                service = GitHubAuthService()
                result = await service.poll_for_token("device_code")

                assert result["status"] == "error"
                assert "denied" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_success_saves_token(self):
        """Test successful authentication saves token."""
        mock_token_response = MagicMock()
        mock_token_response.status_code = 200
        mock_token_response.json.return_value = {"access_token": "ghp_token123"}

        mock_user_response = MagicMock()
        mock_user_response.status_code = 200
        mock_user_response.json.return_value = {"login": "testuser"}

        with patch.dict(os.environ, {"GITHUB_CLIENT_ID": "test-id"}):
            with patch('httpx.AsyncClient') as mock_client_class:
                mock_client = AsyncMock()
                mock_client.post.return_value = mock_token_response
                mock_client.get.return_value = mock_user_response
                mock_client_class.return_value.__aenter__.return_value = mock_client

                with patch('services.github_auth.set_setting') as mock_set, \
                     patch('services.github_auth.reset_github_service'):

                    service = GitHubAuthService()
                    result = await service.poll_for_token("device_code")

                    assert result["status"] == "success"
                    assert result["access_token"] == "ghp_token123"
                    assert mock_set.call_count == 2


class TestGetUsername:
    """Tests for _get_username static method."""

    @pytest.mark.asyncio
    async def test_returns_username_on_success(self):
        """Test returns username on successful request."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"login": "testuser"}

        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            result = await GitHubAuthService._get_username("token")

            assert result == "testuser"

    @pytest.mark.asyncio
    async def test_returns_none_on_failure(self):
        """Test returns None on failed request."""
        mock_response = MagicMock()
        mock_response.status_code = 401

        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            result = await GitHubAuthService._get_username("invalid_token")

            assert result is None


class TestGetConnectionStatus:
    """Tests for get_connection_status static method."""

    @pytest.mark.asyncio
    async def test_returns_disconnected_without_token(self):
        """Test returns disconnected when no token stored."""
        with patch('services.github_auth.get_setting', return_value=None):
            result = await GitHubAuthService.get_connection_status()

            assert isinstance(result, ConnectionStatus)
            assert result.connected is False

    @pytest.mark.asyncio
    async def test_returns_connected_with_valid_token(self):
        """Test returns connected with valid token."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "resources": {
                "core": {"remaining": 4500, "limit": 5000}
            }
        }

        with patch('services.github_auth.get_setting') as mock_get:
            mock_get.side_effect = lambda key: {
                "github_token": "valid_token",
                "github_username": "testuser",
            }.get(key.value if hasattr(key, 'value') else key)

            with patch('httpx.AsyncClient') as mock_client_class:
                mock_client = AsyncMock()
                mock_client.get.return_value = mock_response
                mock_client_class.return_value.__aenter__.return_value = mock_client

                result = await GitHubAuthService.get_connection_status()

                assert result.connected is True
                assert result.rate_limit_remaining == 4500
                assert result.rate_limit_total == 5000

    @pytest.mark.asyncio
    async def test_handles_401_invalid_token(self):
        """Test handles 401 (invalid token) and cleans up."""
        mock_response = MagicMock()
        mock_response.status_code = 401

        with patch('services.github_auth.get_setting', return_value="invalid_token"):
            with patch('services.github_auth.delete_setting') as mock_delete, \
                 patch('services.github_auth.reset_github_service'):
                with patch('httpx.AsyncClient') as mock_client_class:
                    mock_client = AsyncMock()
                    mock_client.get.return_value = mock_response
                    mock_client_class.return_value.__aenter__.return_value = mock_client

                    result = await GitHubAuthService.get_connection_status()

                    assert result.connected is False
                    assert "expired" in result.error.lower() or "revoked" in result.error.lower()
                    assert mock_delete.call_count >= 1

    @pytest.mark.asyncio
    async def test_handles_timeout(self):
        """Test handles timeout gracefully."""
        with patch('services.github_auth.get_setting') as mock_get:
            mock_get.side_effect = lambda key: "token" if "token" in str(key) else "user"

            with patch('httpx.AsyncClient') as mock_client_class:
                mock_client = AsyncMock()
                mock_client.get.side_effect = httpx.TimeoutException("Timeout")
                mock_client_class.return_value.__aenter__.return_value = mock_client

                result = await GitHubAuthService.get_connection_status()

                assert result.connected is True  # Assume connected on timeout
                assert "timeout" in result.error.lower()


class TestDisconnect:
    """Tests for disconnect static method."""

    def test_removes_credentials(self):
        """Test removes stored credentials."""
        with patch('services.github_auth.delete_setting') as mock_delete, \
             patch('services.github_auth.reset_github_service'):
            mock_delete.return_value = True

            result = GitHubAuthService.disconnect()

            assert result is True
            assert mock_delete.call_count == 2

    def test_returns_false_when_no_credentials(self):
        """Test returns False when no credentials existed."""
        with patch('services.github_auth.delete_setting', return_value=False), \
             patch('services.github_auth.reset_github_service'):

            result = GitHubAuthService.disconnect()

            assert result is False


class TestGetGitHubAuthService:
    """Tests for get_github_auth_service function."""

    def test_returns_singleton(self):
        """Test returns the same instance."""
        import services.github_auth as auth_module
        auth_module._auth_service = None

        s1 = get_github_auth_service()
        s2 = get_github_auth_service()

        assert s1 is s2

    def test_creates_instance(self):
        """Test creates GitHubAuthService instance."""
        import services.github_auth as auth_module
        auth_module._auth_service = None

        service = get_github_auth_service()

        assert isinstance(service, GitHubAuthService)


class TestDataClasses:
    """Tests for dataclasses."""

    def test_device_code_response(self):
        """Test DeviceCodeResponse creation."""
        response = DeviceCodeResponse(
            device_code="dc123",
            user_code="ABCD-1234",
            verification_uri="https://github.com/login/device",
            expires_in=900,
            interval=5,
        )

        assert response.device_code == "dc123"
        assert response.user_code == "ABCD-1234"
        assert response.expires_in == 900

    def test_connection_status_connected(self):
        """Test ConnectionStatus for connected state."""
        status = ConnectionStatus(
            connected=True,
            username="testuser",
            rate_limit_remaining=4500,
            rate_limit_total=5000,
        )

        assert status.connected is True
        assert status.username == "testuser"
        assert status.error is None

    def test_connection_status_disconnected(self):
        """Test ConnectionStatus for disconnected state."""
        status = ConnectionStatus(connected=False, error="No token")

        assert status.connected is False
        assert status.error == "No token"


class TestGitHubAuthError:
    """Tests for GitHubAuthError exception."""

    def test_error_creation(self):
        """Test error creation."""
        error = GitHubAuthError("Test error message")

        assert str(error) == "Test error message"
