"""
Time utilities for consistent datetime handling.
All timestamps are in UTC as naive datetime (no tzinfo), matching SQLite's storage format.
"""

from datetime import datetime, timezone, date


def utc_now() -> datetime:
    """
    Get the current UTC datetime as naive datetime (no tzinfo).
    SQLite stores datetime without timezone info, so all timestamps
    must be naive to ensure consistent comparisons.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)


def utc_today() -> date:
    """
    Get the current UTC date.
    """
    return utc_now().date()
