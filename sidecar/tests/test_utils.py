"""
Tests for utility functions.
"""

import sys
import os
from datetime import datetime, timezone

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.time import utc_now


class TestTimeUtils:
    """Test cases for time utilities."""

    def test_utc_now_returns_datetime(self):
        """Test that utc_now returns a datetime object."""
        result = utc_now()
        assert isinstance(result, datetime)

    def test_utc_now_is_timezone_aware(self):
        """Test that utc_now returns timezone-aware datetime."""
        result = utc_now()
        assert result.tzinfo is not None

    def test_utc_now_is_utc(self):
        """Test that utc_now returns UTC timezone."""
        result = utc_now()
        assert result.tzinfo == timezone.utc

    def test_utc_now_is_recent(self):
        """Test that utc_now returns current time."""
        before = datetime.now(timezone.utc)
        result = utc_now()
        after = datetime.now(timezone.utc)
        assert before <= result <= after
