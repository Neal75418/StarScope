"""
Tests for scheduler router endpoints, including rate-limit (429) behavior.
"""

from unittest.mock import patch, AsyncMock

import pytest


class TestSchedulerEndpoints:
    """Tests for scheduler router CRUD operations."""

    def test_get_status(self, client):
        """Test GET /api/scheduler/status returns scheduler state."""
        response = client.get("/api/scheduler/status")
        assert response.status_code == 200
        data = response.json()
        assert "running" in data
        assert "jobs" in data

    def test_post_start(self, client):
        """Test POST /api/scheduler/start starts the scheduler."""
        with patch("routers.scheduler.start_scheduler") as mock_start:
            response = client.post("/api/scheduler/start")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "started"
        mock_start.assert_called_once()

    def test_post_start_with_custom_interval(self, client):
        """Test POST /api/scheduler/start with custom interval."""
        with patch("routers.scheduler.start_scheduler") as mock_start:
            response = client.post(
                "/api/scheduler/start",
                json={"fetch_interval_minutes": 30},
            )
        assert response.status_code == 200
        assert response.json()["interval_minutes"] == 30
        mock_start.assert_called_once_with(fetch_interval_minutes=30)

    def test_post_stop(self, client):
        """Test POST /api/scheduler/stop stops the scheduler."""
        with patch("routers.scheduler.stop_scheduler") as mock_stop:
            response = client.post("/api/scheduler/stop")
        assert response.status_code == 200
        assert response.json()["status"] == "stopped"
        mock_stop.assert_called_once()

    def test_post_fetch_now(self, client):
        """Test POST /api/scheduler/fetch-now triggers immediate fetch."""
        with patch("routers.scheduler.trigger_fetch_now", new_callable=AsyncMock):
            response = client.post("/api/scheduler/fetch-now")
        assert response.status_code == 200
        assert response.json()["status"] == "fetch_triggered"

    def test_start_error_returns_500(self, client):
        """Test POST /api/scheduler/start returns 500 on error."""
        with patch("routers.scheduler.start_scheduler", side_effect=RuntimeError("fail")):
            response = client.post("/api/scheduler/start")
        assert response.status_code == 500
        assert "fail" in response.json()["detail"]

    def test_stop_error_returns_500(self, client):
        """Test POST /api/scheduler/stop returns 500 on error."""
        with patch("routers.scheduler.stop_scheduler", side_effect=RuntimeError("fail")):
            response = client.post("/api/scheduler/stop")
        assert response.status_code == 500


@pytest.fixture(autouse=True, scope="function")
def _reset_limiter():
    """Reset rate limiter storage before each test to avoid cross-test pollution."""
    from middleware.rate_limit import limiter

    # slowapi's Limiter wraps a limits.storage; reset clears all counters
    storage = getattr(limiter, "_storage", None)
    if storage and hasattr(storage, "reset"):
        storage.reset()
    yield
    if storage and hasattr(storage, "reset"):
        storage.reset()


class TestSchedulerRateLimit:
    """Tests for scheduler endpoint rate limiting."""

    def test_start_rate_limited_after_5_requests(self, client):
        """Test POST /api/scheduler/start returns 429 after exceeding limit."""
        with patch("routers.scheduler.start_scheduler"):
            # Send requests until 429, should happen within 10 tries
            success_count = 0
            for _ in range(10):
                resp = client.post("/api/scheduler/start")
                if resp.status_code == 429:
                    break
                assert resp.status_code == 200
                success_count += 1
            else:
                pytest.fail("Expected 429 but never received it within 10 requests")

            # Should have gotten at most 5 successes (5/minute limit)
            assert success_count <= 5

    def test_stop_rate_limited_after_5_requests(self, client):
        """Test POST /api/scheduler/stop returns 429 after exceeding limit."""
        with patch("routers.scheduler.stop_scheduler"):
            success_count = 0
            for _ in range(10):
                resp = client.post("/api/scheduler/stop")
                if resp.status_code == 429:
                    break
                assert resp.status_code == 200
                success_count += 1
            else:
                pytest.fail("Expected 429 but never received it within 10 requests")

            assert success_count <= 5

    def test_fetch_now_rate_limited_after_5_requests(self, client):
        """Test POST /api/scheduler/fetch-now returns 429 after exceeding limit."""
        with patch("routers.scheduler.trigger_fetch_now", new_callable=AsyncMock):
            success_count = 0
            for _ in range(10):
                resp = client.post("/api/scheduler/fetch-now")
                if resp.status_code == 429:
                    break
                assert resp.status_code == 200
                success_count += 1
            else:
                pytest.fail("Expected 429 but never received it within 10 requests")

            assert success_count <= 5

    def test_status_allows_more_requests_than_mutation_endpoints(self, client):
        """Test GET /api/scheduler/status has a higher rate limit (30/min)."""
        # Should handle at least 6 requests without 429 (mutation limit is 5)
        for i in range(6):
            resp = client.get("/api/scheduler/status")
            assert resp.status_code == 200, f"Request {i+1} should succeed"

    def test_rate_limit_response_format(self, client):
        """Test rate limit response contains expected detail message."""
        with patch("routers.scheduler.start_scheduler"):
            # Exhaust the limit
            for _ in range(10):
                resp = client.post("/api/scheduler/start")
                if resp.status_code == 429:
                    break

            assert resp.status_code == 429
            data = resp.json()
            assert "detail" in data
            assert "Rate limit exceeded" in data["detail"]
