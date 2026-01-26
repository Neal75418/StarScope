"""
Pydantic schemas for Discovery (GitHub Search) API.
"""

from typing import List, Optional
from pydantic import BaseModel, Field


class DiscoveryRepo(BaseModel):
    """A repository returned from GitHub Search API."""

    id: int = Field(description="GitHub repository ID")
    full_name: str = Field(description="Full name (owner/repo)")
    owner: str = Field(description="Repository owner username")
    name: str = Field(description="Repository name")
    description: Optional[str] = Field(default=None, description="Repository description")
    language: Optional[str] = Field(default=None, description="Primary programming language")
    stars: int = Field(description="Star count")
    forks: int = Field(description="Fork count")
    url: str = Field(description="GitHub URL")
    topics: List[str] = Field(default_factory=list, description="Repository topics")
    created_at: str = Field(description="Creation timestamp (ISO 8601)")
    updated_at: str = Field(description="Last update timestamp (ISO 8601)")


class SearchResponse(BaseModel):
    """Response from GitHub repository search."""

    repos: List[DiscoveryRepo] = Field(description="List of matching repositories")
    total_count: int = Field(description="Total number of results (may exceed returned items)")
    page: int = Field(description="Current page number")
    per_page: int = Field(description="Results per page")
    has_more: bool = Field(description="Whether more results are available")
