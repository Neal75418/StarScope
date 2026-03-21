"""Discovery（GitHub 搜尋）API 的 Pydantic schemas。"""

from pydantic import BaseModel, Field


class DiscoveryRepo(BaseModel):
    """A repository returned from GitHub Search API."""

    id: int = Field(description="GitHub repository ID")
    full_name: str = Field(description="Full name (owner/repo)")
    owner: str = Field(description="Repository owner username")
    name: str = Field(description="Repository name")
    description: str | None = Field(default=None, description="Repository description")
    language: str | None = Field(default=None, description="Primary programming language")
    stars: int = Field(description="Star count")
    forks: int = Field(description="Fork count")
    url: str = Field(description="GitHub URL")
    topics: list[str] = Field(default_factory=list, description="Repository topics")
    created_at: str = Field(description="Creation timestamp (ISO 8601)")
    updated_at: str = Field(description="Last update timestamp (ISO 8601)")
    owner_avatar_url: str | None = Field(default=None, description="Owner avatar URL")
    open_issues_count: int = Field(default=0, description="Open issues count")
    license_spdx: str | None = Field(default=None, description="License SPDX identifier")
    license_name: str | None = Field(default=None, description="License display name")
    archived: bool = Field(default=False, description="Whether the repository is archived")


class SearchResponse(BaseModel):
    """GitHub 儲存庫搜尋回應。"""

    repos: list[DiscoveryRepo] = Field(description="List of matching repositories")
    total_count: int = Field(description="Total number of results (may exceed returned items)")
    page: int = Field(description="Current page number")
    per_page: int = Field(description="Results per page")
    has_more: bool = Field(description="Whether more results are available")
