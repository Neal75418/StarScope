"""
Tests for utility functions.
"""

from datetime import datetime, timezone

from utils.time import utc_now


class TestTimeUtils:
    """Test cases for time utilities."""

    def test_utc_now_returns_datetime(self):
        """Test that utc_now returns a datetime object."""
        result = utc_now()
        assert isinstance(result, datetime)

    def test_utc_now_is_naive(self):
        """Test that utc_now returns naive datetime (no tzinfo) for SQLite compatibility."""
        result = utc_now()
        assert result.tzinfo is None

    def test_utc_now_is_recent(self):
        """Test that utc_now returns current time."""
        before = datetime.now(timezone.utc).replace(tzinfo=None)
        result = utc_now()
        after = datetime.now(timezone.utc).replace(tzinfo=None)
        assert before <= result <= after
