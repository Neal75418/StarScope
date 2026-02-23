# API 響應格式統一化 - 遷移指南

## 概述

本指南說明如何將現有的路由器從自定義響應格式遷移到統一的 `ApiResponse` 格式。

## 當前狀態

- ✅ **已完成**: `schemas/response.py` 包含完整的 `ApiResponse[T]` 實現
- ✅ **已完成**: 15 個路由模組已遷移至 `ApiResponse` 格式（`export.py` 使用 `StreamingResponse`，屬正常例外）

## 遷移範例

### 範例 1: 簡單列表端點

**Before** (`routers/repos.py`):
```python
@router.get("/repos", response_model=RepoListResponse)
async def list_repos(...) -> RepoListResponse:
    return RepoListResponse(repos=[...], total=100)
```

**After**:
```python
from schemas.response import ApiResponse, success_response

@router.get("/repos", response_model=ApiResponse[list[RepoWithSignals]])
async def list_repos(...) -> dict:
    repos_with_signals = [...]  # 原本的邏輯
    return success_response(
        data=repos_with_signals,
        message=f"Found {len(repos_with_signals)} repositories"
    )
```

### 範例 2: 帶分頁的列表端點

**Before**:
```python
return RepoListResponse(
    repos=repos_with_signals,
    total=total,
    page=page,
    per_page=per_page,
    total_pages=total_pages,
)
```

**After**:
```python
from schemas.response import paginated_response

return paginated_response(
    items=repos_with_signals,
    total=total,
    page=page,
    per_page=per_page,
    message="Successfully retrieved repositories"
)
```

### 範例 3: 錯誤處理

**Before**:
```python
raise HTTPException(
    status_code=404,
    detail="Repository not found"
)
```

**After**:
```python
from schemas.response import error_response, ErrorCode
from fastapi.responses import JSONResponse

return JSONResponse(
    status_code=404,
    content=error_response(
        message="Repository not found",
        code=ErrorCode.NOT_FOUND,
        details={"owner": owner, "name": name}
    )
)
```

或使用全域異常處理器（推薦）:
```python
# main.py
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content=error_response(
            message=str(exc.detail),
            code=_map_status_to_error_code(exc.status_code)
        )
    )
```

### 範例 4: 單一資源端點

**Before**:
```python
@router.get("/repos/{repo_id}", response_model=RepoWithSignals)
async def get_repo(repo: Repo = Depends(get_repo_or_404), ...) -> RepoWithSignals:
    return get_repo_with_signals(repo, db)
```

**After**:
```python
@router.get("/repos/{repo_id}", response_model=ApiResponse[RepoWithSignals])
async def get_repo(repo: Repo = Depends(get_repo_or_404), ...) -> dict:
    repo_data = get_repo_with_signals(repo, db)
    return success_response(
        data=repo_data,
        message=f"Repository {repo.full_name} retrieved successfully"
    )
```

## 遷移檢查清單

### 階段 1: 基礎設施

- [x] 建立 `schemas/response.py`
- [x] 在 `main.py` 建立全域異常處理器
- [x] 更新 `schemas/__init__.py` 匯出 `ApiResponse` 相關類別

### 階段 2: 路由器遷移 (16 個模組)

**高優先級** (核心 CRUD 操作):
- [x] `routers/repos.py` - 主要的 repo 管理
- [x] `routers/early_signals.py` - 早期訊號
- [x] `routers/trends.py` - 趨勢資料

**中優先級**:
- [x] `routers/alerts.py`
- [x] `routers/categories.py`
- [x] `routers/discovery.py`
- [x] `routers/recommendations.py`
- [x] `routers/github_auth.py`

**低優先級** (輔助端點):
- [x] `routers/charts.py`
- [x] `routers/context.py`
- [x] `routers/export.py` — 使用 `StreamingResponse`（檔案下載端點，不適用 ApiResponse）
- [x] `routers/health.py`
- [x] `routers/scheduler.py`
- [x] `routers/commit_activity.py`
- [x] `routers/languages.py`
- [x] `routers/star_history.py`

### 階段 3: 前端更新

**TypeScript 型別定義** (`src/api/types.ts`):
```typescript
// 新增統一的 API 響應型別
export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  message: string | null;
  error: {
    code: string;
    details: any;
  } | null;
  pagination?: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

// 更新現有介面以包裝在 ApiResponse 中
export type ReposListResponse = ApiResponse<Repo[]>;
export type RepoDetailResponse = ApiResponse<Repo>;
```

**API Client 更新** (`src/api/client.ts`):
```typescript
export async function apiCall<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  const json: ApiResponse<T> = await response.json();

  if (!json.success || json.error) {
    throw new Error(json.message || json.error?.code || "Unknown error");
  }

  return json.data as T;
}
```

### 階段 4: 測試更新

更新所有測試以檢查新的響應格式：

```python
# sidecar/tests/test_repos.py
def test_list_repos(test_client):
    response = test_client.get("/api/repos")
    assert response.status_code == 200

    data = response.json()
    assert data["success"] is True
    assert "data" in data
    assert isinstance(data["data"], list)
    assert data["error"] is None
```

## 破壞性變更處理

### 選項 1: 版本化 API (推薦)

在 `main.py` 中建立新版本:
```python
from fastapi import APIRouter

# v1 - 舊格式 (向後相容)
v1_router = APIRouter(prefix="/api/v1")
v1_router.include_router(old_repos_router)

# v2 - 新格式
v2_router = APIRouter(prefix="/api/v2")
v2_router.include_router(new_repos_router)

app.include_router(v1_router)
app.include_router(v2_router)

# /api/* 預設指向 v2
app.include_router(v2_router, prefix="/api")
```

### 選項 2: 功能開關

```python
# config.py
USE_UNIFIED_RESPONSE_FORMAT = os.getenv("USE_UNIFIED_RESPONSE", "false").lower() == "true"

# routers/repos.py
if USE_UNIFIED_RESPONSE_FORMAT:
    return success_response(data=repos)
else:
    return RepoListResponse(repos=repos)
```

## 預期效益

遷移完成後：
- ✅ 一致的錯誤處理
- ✅ 前端可以統一解析響應
- ✅ 更好的 API 文件（OpenAPI/Swagger）
- ✅ 減少前端程式碼重複

## 預估工作量

- 基礎設施設定: 2 小時
- 每個路由器遷移: 30 分鐘
- 前端更新: 3-4 小時
- 測試更新: 2-3 小時

**總計**: 約 15-20 小時（可分階段進行）

## 立即行動

建議先完成一個完整的範例端點作為 POC：

```bash
# 1. 更新一個簡單的端點
編輯 sidecar/routers/health.py

# 2. 測試
curl http://localhost:8008/api/health

# 3. 確認新格式正常運作後再推廣到其他端點
```
