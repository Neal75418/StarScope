"""
Pydantic schemas for Repo-related API endpoints.
"""

from datetime import datetime
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
    owner: str | None = Field(None, max_length=MAX_OWNER_LENGTH)
    name: str | None = Field(None, max_length=MAX_REPO_NAME_LENGTH)
    url: str | None = None  # Alternative: provide full GitHub URL

    @field_validator("owner")
    @classmethod
    def validate_owner(cls, v: str | None) -> str | None:
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
    def validate_name(cls, v: str | None) -> str | None:
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
    def parse_github_url(cls, v: str | None) -> str | None:
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


class RepoResponse(BaseModel):
    """Schema for a repo response."""
    id: int
    owner: str
    name: str
    full_name: str
    url: str
    description: str | None = None
    language: str | None = None
    added_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RepoWithSignals(RepoResponse):
    """Schema for a repo with its latest signals."""
    # Current stats (from latest snapshot)
    stars: int | None = None
    forks: int | None = None

    # Signals
    stars_delta_7d: float | None = None
    stars_delta_30d: float | None = None
    velocity: float | None = None  # stars per day
    acceleration: float | None = None
    trend: int | None = None  # -1, 0, 1

    # Fork 與 Issue 趨勢
    forks_delta_7d: float | None = None
    forks_delta_30d: float | None = None
    issues_delta_7d: float | None = None
    issues_delta_30d: float | None = None

    # Latest snapshot date
    last_fetched: datetime | None = None


class RepoListResponse(BaseModel):
    """Schema for listing repos."""
    repos: list[RepoWithSignals]
    total: int
    page: int | None = None
    per_page: int | None = None
    total_pages: int | None = None


class StarredRepo(BaseModel):
    """GitHub starred repo 的精簡資訊。"""
    owner: str
    name: str
    full_name: str
    description: str | None = None
    language: str | None = None
    stars: int
    url: str
    topics: list[str] = []


class StarredReposResponse(BaseModel):
    """取得 starred repos 的回應。"""
    repos: list[StarredRepo]
    total: int


class BatchRepoCreate(BaseModel):
    """批次匯入 repo 的請求（上限 100 筆）。"""
    repos: list[RepoCreate] = Field(..., max_length=100)


class BatchImportResult(BaseModel):
    """批次匯入結果。"""
    total: int
    success: int
    skipped: int
    failed: int
    errors: list[str] = []
