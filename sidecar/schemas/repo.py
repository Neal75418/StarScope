"""
Pydantic schemas for Repo-related API endpoints.
"""

from datetime import datetime, date
from typing import Optional, List
from pydantic import BaseModel, Field, field_validator
import re


class RepoCreate(BaseModel):
    """Schema for creating a new repo in watchlist."""
    owner: Optional[str] = None
    name: Optional[str] = None
    url: Optional[str] = None  # Alternative: provide full GitHub URL

    @field_validator("url")
    @classmethod
    def parse_github_url(cls, v: Optional[str]) -> Optional[str]:
        """Validate and normalize GitHub URL."""
        if v is None:
            return None
        # Accept various GitHub URL formats
        patterns = [
            r"https?://github\.com/([^/]+)/([^/]+)/?.*",
            r"github\.com/([^/]+)/([^/]+)/?.*",
        ]
        for pattern in patterns:
            match = re.match(pattern, v)
            if match:
                return f"https://github.com/{match.group(1)}/{match.group(2)}"
        return v

    def get_owner_name(self) -> tuple[str, str]:
        """Extract owner and name from the input."""
        if self.owner and self.name:
            return self.owner, self.name
        if self.url:
            match = re.match(r"https?://github\.com/([^/]+)/([^/]+)/?", self.url)
            if match:
                return match.group(1), match.group(2)
        raise ValueError("Must provide either owner+name or a valid GitHub URL")


class SnapshotResponse(BaseModel):
    """Schema for a repo snapshot."""
    id: int
    stars: int
    forks: int
    watchers: int
    open_issues: int
    snapshot_date: date
    fetched_at: datetime

    model_config = {"from_attributes": True}


class SignalResponse(BaseModel):
    """Schema for a calculated signal."""
    id: int
    signal_type: str
    value: float
    calculated_at: datetime

    model_config = {"from_attributes": True}


class RepoResponse(BaseModel):
    """Schema for a repo response."""
    id: int
    owner: str
    name: str
    full_name: str
    url: str
    description: Optional[str] = None
    language: Optional[str] = None
    added_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RepoWithSignals(RepoResponse):
    """Schema for a repo with its latest signals."""
    # Current stats (from latest snapshot)
    stars: Optional[int] = None
    forks: Optional[int] = None

    # Signals
    stars_delta_7d: Optional[float] = None
    stars_delta_30d: Optional[float] = None
    velocity: Optional[float] = None  # stars per day
    acceleration: Optional[float] = None
    trend: Optional[int] = None  # -1, 0, 1

    # Latest snapshot date
    last_fetched: Optional[datetime] = None


class RepoListResponse(BaseModel):
    """Schema for listing repos."""
    repos: List[RepoWithSignals]
    total: int
