# Full Backlog Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete all 8 backlog items to push the project from 8.5 to 9+.

**Architecture:** Three waves ordered by dependency — (Wave A) fix remaining correctness issues and tests, (Wave B) upgrade backend observability, (Wave C) unify frontend UX patterns and E2E.

**Tech Stack:** React 19, TypeScript, React Query v5, Vitest, Playwright, Python FastAPI, SQLAlchemy, APScheduler

---

## Current Status (What's Already Done)

| Item | Status | Remaining |
|------|--------|-----------|
| #1 Discovery contract | 70% | verify clear/restore/quick picks consistency |
| #2 Discovery tests | 60% | restoreState test, rapid filter change test |
| #3 Error/degradation | 50% | error code→degradation mapping, page consistency |
| #4 Sidecar lifecycle | 90% | verify no edge cases |
| #5 Lifecycle tests | 0% | new file |
| #6 Diagnostics health | 30% | scheduler health, rate limit, dynamic data |
| #7 E2E flows | 40% | discovery filter-only, GitHub connection |
| #8 Async state semantics | 30% | page-level StatusBanner consumption |

---

## Wave A: Correctness & Tests (Tasks 1–8)

### Task 1: Discovery — verify clear/restore/quick picks

**Files:**
- Read: `src/hooks/useDiscovery.ts:85-141`
- Test: `src/hooks/__tests__/useDiscoverySearch.test.ts`

**Step 1:** Write test for restoreState triggering search

```typescript
it("restoreState triggers search with restored params", async () => {
  mockFetchResults.mockResolvedValueOnce({
    repos: [makeDiscoveryRepo({ full_name: "restored/repo" })],
    totalCount: 1,
    hasMore: false,
  });

  const { result } = renderHook(() => useDiscoverySearch(), { wrapper: createWrapper() });

  act(() => {
    result.current.executeSearch("restored-keyword", "weekly", { language: "Python" });
  });

  await waitFor(() => {
    expect(result.current.repos).toHaveLength(1);
    expect(result.current.repos[0].full_name).toBe("restored/repo");
  });
});
```

**Step 2:** Write test for topic-only filter (no keyword, no period, just topic)

```typescript
it("topic-only filter triggers search", async () => {
  mockFetchResults.mockResolvedValueOnce({
    repos: [makeDiscoveryRepo({ full_name: "topic/only" })],
    totalCount: 5,
    hasMore: false,
  });

  const { result } = renderHook(() => useDiscoverySearch(), { wrapper: createWrapper() });

  act(() => {
    result.current.executeSearch("", undefined, { topic: "machine-learning" });
  });

  await waitFor(() => {
    expect(result.current.repos).toHaveLength(1);
  });

  expect(mockFetchResults).toHaveBeenCalledWith(
    "stars:>=0",
    expect.objectContaining({ topic: "machine-learning" }),
    1,
    expect.anything(),
    expect.anything()
  );
});
```

**Step 3:** Run tests, commit

```bash
npm run test -- --run src/hooks/__tests__/useDiscoverySearch.test.ts
git commit -m "test: verify restoreState and topic-only Discovery search"
```

---

### Task 2: Discovery — hideArchived filter-only

**Files:**
- Test: `src/hooks/__tests__/useDiscoverySearch.test.ts`

**Step 1:** Write test

```typescript
it("hideArchived-only filter triggers search", async () => {
  mockFetchResults.mockResolvedValueOnce({
    repos: [makeDiscoveryRepo()],
    totalCount: 1,
    hasMore: false,
  });

  const { result } = renderHook(() => useDiscoverySearch(), { wrapper: createWrapper() });

  act(() => {
    result.current.executeSearch("", undefined, { hideArchived: true });
  });

  await waitFor(() => {
    expect(result.current.repos).toHaveLength(1);
  });
});
```

**Step 2:** Run and commit

---

### Task 3: Sidecar lifecycle tests

**Files:**
- Create: `sidecar/tests/test_main_lifecycle.py`
- Read: `sidecar/main.py:70-90`

**Step 1:** Write lifecycle tests

```python
"""Sidecar 啟停生命週期測試。"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.fixture
def mock_services():
    """模擬所有 lifecycle 依賴。"""
    with (
        patch("main.init_db") as init_db,
        patch("main.start_scheduler") as start_scheduler,
        patch("main.stop_scheduler") as stop_scheduler,
        patch("main.close_github_service", new_callable=AsyncMock) as close_github,
        patch("main.trigger_fetch_now", new_callable=AsyncMock) as trigger_fetch,
    ):
        yield {
            "init_db": init_db,
            "start_scheduler": start_scheduler,
            "stop_scheduler": stop_scheduler,
            "close_github": close_github,
            "trigger_fetch": trigger_fetch,
        }


class TestShutdownOrder:
    """shutdown 順序：stop_scheduler → await task → close_github。"""

    @pytest.mark.asyncio
    async def test_shutdown_stops_scheduler_before_closing_client(self, mock_services):
        """排程器應在 HTTP client 之前停止。"""
        call_order = []
        mock_services["stop_scheduler"].side_effect = lambda: call_order.append("stop_scheduler")
        mock_services["close_github"].side_effect = lambda: call_order.append("close_github")
        mock_services["trigger_fetch"].return_value = None

        from main import lifespan, app

        async with lifespan(app):
            pass  # startup completes

        # shutdown runs
        assert call_order.index("stop_scheduler") < call_order.index("close_github")

    @pytest.mark.asyncio
    async def test_startup_task_cancel_is_awaited(self, mock_services):
        """取消的 startup task 應被 await（無 unhandled exception）。"""
        # 讓 startup task 永遠不完成
        never_done = asyncio.Future()
        mock_services["trigger_fetch"].return_value = never_done

        from main import lifespan, app

        async with lifespan(app):
            pass  # startup runs, task is pending

        # shutdown should cancel and await without exception
        # If not awaited, asyncio would warn about unawaited task


class TestStartupFetchFailure:
    """startup fetch 失敗不應阻止應用啟動。"""

    @pytest.mark.asyncio
    async def test_startup_fetch_error_does_not_crash(self, mock_services):
        """startup fetch 拋出例外時應用仍能啟動。"""
        mock_services["trigger_fetch"].side_effect = Exception("GitHub API down")

        from main import lifespan, app

        async with lifespan(app):
            pass  # should not raise
```

**Step 2:** Run

```bash
cd sidecar && source .venv/bin/activate
python -m pytest tests/test_main_lifecycle.py -v
```

**Step 3:** Commit

```bash
git commit -m "test: add sidecar lifecycle tests (shutdown order, task cancel)"
```

---

### Task 4: Scheduler health tracking (backend)

**Files:**
- Modify: `sidecar/services/scheduler.py`
- Modify: `sidecar/routers/app_settings.py`

**Step 1:** Add health tracking to scheduler

在 `scheduler.py` 頂部加模組級變數：

```python
import time as _time

# 排程健康狀態追蹤
_scheduler_health: dict[str, float | str | None] = {
    "last_fetch_success": None,    # Unix timestamp
    "last_fetch_failure": None,
    "last_fetch_error": None,      # 最近一次錯誤訊息
    "last_alert_check": None,
    "last_backup": None,
}


def get_scheduler_health() -> dict[str, float | str | None]:
    """取得排程器健康狀態。"""
    return dict(_scheduler_health)
```

在 `fetch_all_repos_job` 成功/失敗時更新：

```python
# 成功時
_scheduler_health["last_fetch_success"] = _time.time()

# 失敗時
_scheduler_health["last_fetch_failure"] = _time.time()
_scheduler_health["last_fetch_error"] = str(e)[:200]
```

**Step 2:** Update diagnostics endpoint to include scheduler health

在 `app_settings.py` 的 `DiagnosticsResponse` 加欄位：

```python
last_fetch_success: str | None  # ISO format
last_fetch_failure: str | None
last_fetch_error: str | None
github_rate_limit_remaining: int | None
github_rate_limit_total: int | None
```

在 endpoint 中呼叫 `get_scheduler_health()` 和 `get_github_connection_status()`。

**Step 3:** Run backend tests, commit

```bash
python -m pytest tests/ -x -q
git commit -m "feat: add scheduler health tracking to diagnostics"
```

---

### Task 5: DiagnosticsSection — display dynamic health

**Files:**
- Modify: `src/components/settings/DiagnosticsSection.tsx`
- Modify: `src/api/types.ts` (update DiagnosticsResponse)
- Modify: `src/i18n/translations.ts`

**Step 1:** Update `DiagnosticsResponse` type

```typescript
export interface DiagnosticsResponse {
  version: string;
  db_path: string;
  db_size_mb: number;
  total_repos: number;
  total_snapshots: number;
  last_snapshot_at: string | null;
  uptime_seconds: number;
  // 新增
  last_fetch_success: string | null;
  last_fetch_failure: string | null;
  last_fetch_error: string | null;
  github_rate_limit_remaining: number | null;
  github_rate_limit_total: number | null;
}
```

**Step 2:** Update DiagnosticsSection to display health status

加一個「健康狀態」區塊，用綠/黃/紅指示燈顯示：
- 最近一次同步成功/失敗時間
- GitHub rate limit 狀態
- 最近錯誤訊息

**Step 3:** Add i18n keys, commit

---

### Task 6: Error code → degradation mapping

**Files:**
- Modify: `src/contexts/AppStatusContext.tsx`
- Modify: `src/api/client.ts`

**Step 1:** Add `reportError` to AppStatus for pages to report errors

```typescript
// In AppStatusContext
interface AppStatusInternal extends AppStatus {
  reportError: (error: unknown) => void;
}

// In provider, track rate-limited state
const [isRateLimited, setRateLimited] = useState(false);

const reportError = useCallback((error: unknown) => {
  if (error instanceof ApiError && error.isRateLimited) {
    setRateLimited(true);
    // Auto-clear after 60 seconds
    setTimeout(() => setRateLimited(false), 60_000);
  }
}, []);
```

**Step 2:** Update `useMemo` to include rate-limited check

```typescript
if (isRateLimited) {
  return { level: "rate-limited", showBanner: true, bannerMessage: "rateLimited", ... };
}
```

**Step 3:** Hook into apiCall to report 429 errors globally

```typescript
// In client.ts apiCall, after catch:
if (apiError.status === 429) {
  window.dispatchEvent(new CustomEvent("starscope:rate-limited"));
}
```

**Step 4:** Commit

---

### Task 7: E2E — Discovery filter-only + GitHub connection

**Files:**
- Modify: `e2e/discovery-flow.spec.ts`
- Create: `e2e/github-connection.spec.ts`

**Step 1:** Add filter-only E2E

```typescript
test("filter-only search (language only, no keyword) returns results", async ({ page }) => {
  await page.locator('[data-testid="nav-discovery"]').click();
  // 清除現有趨勢篩選
  const clearBtn = page.locator("button", { hasText: /清除|Clear/ });
  if (await clearBtn.isVisible()) await clearBtn.click();

  // 只選語言
  const langSelect = page.locator('[data-testid="language-filter"]');
  if (await langSelect.isVisible()) {
    await langSelect.selectOption("Python");
  }

  // 應有結果
  await expect(page.locator('[role="status"]')).toContainText(/\d+/, { timeout: 10000 });
});
```

**Step 2:** Add GitHub connection E2E (mock flow)

```typescript
test("shows GitHub connection status in settings", async ({ page }) => {
  await page.locator('[data-testid="nav-settings"]').click();
  const section = page.locator("#github");
  await expect(section).toBeVisible({ timeout: 5000 });
  // 應顯示連線狀態（已連線或未連線）
  await expect(section.locator("text=/已連接|Connected|未連接|Not connected/i")).toBeVisible();
});
```

**Step 3:** Commit

---

### Task 8: Async state semantics — page-level consistency

**Files:**
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/pages/Trends.tsx`
- Modify: `src/pages/Discovery.tsx`

**Step 1:** Ensure all pages show DataFreshnessBar consistently

Dashboard 已有。Trends 和 Discovery 需要加入。

For Trends:
```typescript
// 加 DataFreshnessBar，使用 query.dataUpdatedAt
<DataFreshnessBar
  dataUpdatedAt={dataUpdatedAt}
  isFetching={isFetching}
  onRefresh={retry}
/>
```

For Discovery: results 區塊已有 loading/error 處理，但沒有統一的新鮮度指示。
可以在搜尋結果上方加 `DataFreshnessBar`。

**Step 2:** Commit

---

## Execution Summary

| Wave | Tasks | Est. Time | Dependencies |
|------|-------|-----------|-------------|
| A: Correctness | 1-3 | 45m | Independent |
| B: Observability | 4-6 | 60m | Task 4 → Task 5 |
| C: UX & E2E | 7-8 | 30m | Task 6 for error mapping |

**Total: 8 tasks, ~135 minutes**

**Critical path:** Task 4 (scheduler health) → Task 5 (frontend display) → Task 6 (error mapping)

**Parallelizable:** Tasks 1-3 are independent of Tasks 4-6.
