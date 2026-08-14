"""Discovery（GitHub 搜尋）API 的 Pydantic schemas。"""

from pydantic import BaseModel, Field


class DiscoveryRepo(BaseModel):
    """GitHub Search API 回傳的儲存庫。"""

    id: int = Field(description="GitHub repository ID")
    full_name: str = Field(description="完整名稱（owner/repo）")
    owner: str = Field(description="擁有者帳號")
    name: str = Field(description="儲存庫名稱")
    description: str | None = Field(default=None, description="儲存庫描述")
    language: str | None = Field(default=None, description="主要程式語言")
    stars: int = Field(description="Star 數")
    forks: int = Field(description="Fork 數")
    url: str = Field(description="GitHub URL")
    topics: list[str] = Field(default_factory=list, description="儲存庫 topics")
    created_at: str = Field(description="建立時間（ISO 8601）")
    updated_at: str = Field(description="最後更新時間（ISO 8601）")
    owner_avatar_url: str | None = Field(default=None, description="擁有者頭像 URL")
    open_issues_count: int = Field(default=0, description="開放 issue 數")
    license_spdx: str | None = Field(default=None, description="授權 SPDX 識別碼")
    license_name: str | None = Field(default=None, description="授權顯示名稱")
    archived: bool = Field(default=False, description="儲存庫是否已封存")


class SearchResponse(BaseModel):
    """GitHub 儲存庫搜尋回應。"""

    repos: list[DiscoveryRepo] = Field(description="符合條件的儲存庫清單")
    total_count: int = Field(description="結果總數（可能超過本次回傳筆數）")
    page: int = Field(description="目前頁碼")
    per_page: int = Field(description="每頁筆數")
    has_more: bool = Field(description="是否還有更多結果")
