"""
Pydantic schemas for Repo-related API endpoints.
"""

from datetime import datetime, date
from typing import Optional, List
from pydantic import BaseModel, Field, field_validator, model_validator
import re

from constants import (
    GITHUB_USERNAME_PATTERN,
    GITHUB_REPO_NAME_PATTERN,
    MAX_OWNER_LENGTH,
    MAX_REPO_NAME_LENGTH,
)


class RepoCreate(BaseModel):
    """Schema for creating a new repo in watchlist."""
    owner: Optional[str] = Field(None, max_length=MAX_OWNER_LENGTH)
    name: Optional[str] = Field(None, max_length=MAX_REPO_NAME_LENGTH)
    url: Optional[str] = None  # Alternative: provide full GitHub URL

    @field_validator("owner")
    @classmethod
    def validate_owner(cls, v: Optional[str]) -> Optional[str]:
        """Validate GitHub username format."""
        if v is None:
            return None
        v = v.strip()
        if not re.match(GITHUB_USERNAME_PATTERN, v):
            raise ValueError(
                "Invalid GitHub username. Must be 1-39 alphanumeric characters or hyphens, "
                "cannot start/end with hyphen or have consecutive hyphens."
            )
        return v

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: Optional[str]) -> Optional[str]:
        """Validate GitHub repository name format."""
        if v is None:
            return None
        v = v.strip()
        if not re.match(GITHUB_REPO_NAME_PATTERN, v):
            raise ValueError(
                "Invalid repository name. Must contain only alphanumeric characters, "
                "dots, hyphens, or underscores."
            )
        return v

    @field_validator("url")
    @classmethod
    def parse_github_url(cls, v: Optional[str]) -> Optional[str]:
        """Validate and normalize GitHub URL."""
        if v is None:
            return None
        v = v.strip()
        # Accept various GitHub URL formats
        patterns = [
            r"https?://github\.com/([^/]+)/([^/]+)/?.*",
            r"github\.com/([^/]+)/([^/]+)/?.*",
        ]
        for pattern in patterns:
            match = re.match(pattern, v)
            if match:
                return f"https://github.com/{match.group(1)}/{match.group(2)}"
        raise ValueError("Invalid GitHub URL format. Expected: https://github.com/owner/repo")

    @model_validator(mode="after")
    def validate_input(self) -> "RepoCreate":
        """Ensure either owner+name or url is provided."""
        has_owner_name = self.owner is not None and self.name is not None
        has_url = self.url is not None
        if not has_owner_name and not has_url:
            raise ValueError("Must provide either owner+name or a valid GitHub URL")
        return self

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
