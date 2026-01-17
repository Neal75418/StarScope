"""
Time utilities for consistent datetime handling.
All timestamps should be in UTC with timezone awareness.
"""

from datetime import datetime, timezone, date


def utc_now() -> datetime:
    """
    Get the current UTC datetime with timezone info.
    Preferred over datetime.utcnow() which returns naive datetime.
    """
    return datetime.now(timezone.utc)


def utc_today() -> date:
    """
    Get the current UTC date.
    """
    return utc_now().date()
