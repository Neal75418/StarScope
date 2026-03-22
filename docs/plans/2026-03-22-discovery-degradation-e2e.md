# Discovery Contract + Degradation Strategy + Cross-Layer E2E

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix Discovery search state machine edge cases, unify app-wide degradation strategy, and add E2E tests for the flows most likely to break.

**Architecture:** Three incremental layers — (1) harden Discovery's state transitions and test them, (2) create a shared AppStatus context that maps error codes to degradation states consumed by all pages, (3) add E2E tests that validate cross-layer behavior in CI.

**Tech Stack:** React 19, TypeScript, React Query v5, Vitest, Playwright, Python FastAPI

---

## Phase 1: Discovery Search Contract (Tasks 1–5)

### Task 1: Test — filter change during in-flight cancels and restarts

**Files:**
- Test: `src/hooks/__tests__/useDiscoverySearch.test.ts`

**Step 1: Write the failing test**

```typescript
it("cancels in-flight request when filters change", async () => {
  // 第一次搜尋 — 延遲回應
  let resolveFirst: (v: SearchResult) => void;
  mockSearchRepos.mockReturnValueOnce(
    new Promise<SearchResult>((r) => { resolveFirst = r; })
  );
  // 第二次搜尋 — 即時回應
  mockSearchRepos.mockResolvedValueOnce({
    repos: [makeDiscoveryRepo({ full_name: "new/result" })],
    total_count: 1,
    has_more: false,
    page: 1,
    per_page: 30,
  });

  const { result } = renderHook(() => useDiscoverySearch(), { wrapper });

  // 觸發第一次搜尋
  act(() => { result.current.executeSearch("react", undefined, {}); });
  expect(result.current.loading).toBe(true);

  // 在第一次搜尋進行中改變 filters
  act(() => { result.current.executeSearch("vue", undefined, {}); });

  // 第一次搜尋的結果到達（但應被忽略因為 queryKey 已變）
  act(() => { resolveFirst!({ repos: [], totalCount: 0, hasMore: false }); });

  await waitFor(() => {
    expect(result.current.repos[0]?.full_name).toBe("new/result");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test -- --run src/hooks/__tests__/useDiscoverySearch.test.ts
```
Expected: May pass (React Query handles this natively) — if so, we're confirming existing behavior.

**Step 3: Commit**

```bash
git add src/hooks/__tests__/useDiscoverySearch.test.ts
git commit -m "test: verify filter change cancels in-flight Discovery search"
```

---

### Task 2: Test — filter-only search triggers API request

**Files:**
- Test: `src/hooks/__tests__/useDiscoverySearch.test.ts`

**Step 1: Write the failing test**

```typescript
it("triggers search with filter-only (no keyword, no period)", async () => {
  mockSearchRepos.mockResolvedValueOnce({
    repos: [makeDiscoveryRepo({ full_name: "filtered/repo" })],
    total_count: 1,
    has_more: false,
    page: 1,
    per_page: 30,
  });

  const { result } = renderHook(() => useDiscoverySearch(), { wrapper });

  // 只有 filter，沒有 keyword 或 period
  act(() => {
    result.current.executeSearch("", undefined, { minStars: 1000 });
  });

  await waitFor(() => {
    expect(result.current.repos).toHaveLength(1);
    expect(result.current.repos[0].full_name).toBe("filtered/repo");
  });

  // 驗證 query 使用 stars:>=0 作為 fallback
  expect(mockSearchRepos).toHaveBeenCalledWith(
    "stars:>=0",
    expect.objectContaining({ minStars: 1000 }),
    1,
    expect.anything()
  );
});
```

**Step 2: Run and verify**

```bash
npm run test -- --run src/hooks/__tests__/useDiscoverySearch.test.ts
```

**Step 3: Commit**

```bash
git commit -m "test: verify filter-only Discovery search triggers API request"
```

---

### Task 3: Test — loadMore failure preserves existing results

**Files:**
- Test: `src/hooks/__tests__/useDiscoverySearch.test.ts`

**Step 1: Write the failing test**

```typescript
it("preserves page 1 results when loadMore (page 2) fails", async () => {
  const page1Repos = [
    makeDiscoveryRepo({ full_name: "page1/repo1" }),
    makeDiscoveryRepo({ full_name: "page1/repo2" }),
  ];

  // Page 1 成功
  mockSearchRepos.mockResolvedValueOnce({
    repos: page1Repos,
    total_count: 50,
    has_more: true,
    page: 1,
    per_page: 30,
  });

  const { result } = renderHook(() => useDiscoverySearch(), { wrapper });

  act(() => { result.current.executeSearch("react", undefined, {}); });

  await waitFor(() => {
    expect(result.current.repos).toHaveLength(2);
  });

  // Page 2 失敗
  mockSearchRepos.mockRejectedValueOnce(new Error("Network error"));

  act(() => { result.current.loadMore(); });

  await waitFor(() => {
    expect(result.current.loading).toBe(false);
  });

  // Page 1 結果仍保留
  expect(result.current.repos).toHaveLength(2);
  expect(result.current.repos[0].full_name).toBe("page1/repo1");
  // 有結果時不顯示 error
  expect(result.current.error).toBeNull();
  // totalCount 保留 page 1 的值
  expect(result.current.totalCount).toBe(50);
});
```

**Step 2–3: Run and commit**

```bash
npm run test -- --run src/hooks/__tests__/useDiscoverySearch.test.ts
git commit -m "test: verify loadMore failure preserves existing Discovery results"
```

---

### Task 4: Test — resetSearch clears everything

**Files:**
- Test: `src/hooks/__tests__/useDiscoverySearch.test.ts`

**Step 1: Write the failing test**

```typescript
it("resetSearch clears repos, totalCount, and React Query cache", async () => {
  mockSearchRepos.mockResolvedValueOnce({
    repos: [makeDiscoveryRepo()],
    total_count: 10,
    has_more: false,
    page: 1,
    per_page: 30,
  });

  const { result } = renderHook(() => useDiscoverySearch(), { wrapper });

  act(() => { result.current.executeSearch("react", undefined, {}); });
  await waitFor(() => { expect(result.current.repos).toHaveLength(1); });

  act(() => { result.current.resetSearch(); });

  expect(result.current.repos).toHaveLength(0);
  expect(result.current.totalCount).toBe(0);
  expect(result.current.error).toBeNull();
  expect(result.current.hasMore).toBe(false);
});
```

**Step 2–3: Run and commit**

```bash
npm run test -- --run src/hooks/__tests__/useDiscoverySearch.test.ts
git commit -m "test: verify resetSearch clears all Discovery state"
```

---

### Task 5: Test — quick pick period triggers search

**Files:**
- Test: `src/hooks/__tests__/useDiscoverySearch.test.ts`

**Step 1: Write the failing test**

```typescript
it("period-only search works (no keyword, no filters)", async () => {
  mockSearchRepos.mockResolvedValueOnce({
    repos: [makeDiscoveryRepo({ full_name: "trending/repo" })],
    total_count: 100,
    has_more: true,
    page: 1,
    per_page: 30,
  });

  const { result } = renderHook(() => useDiscoverySearch(), { wrapper });

  act(() => {
    result.current.executeSearch("", "weekly", {});
  });

  await waitFor(() => {
    expect(result.current.repos).toHaveLength(1);
  });

  // query 應包含 created:> 和 stars:>=
  expect(mockSearchRepos).toHaveBeenCalledWith(
    expect.stringContaining("created:>"),
    expect.anything(),
    1,
    expect.anything()
  );
});
```

**Step 2–3: Run and commit**

```bash
npm run test -- --run src/hooks/__tests__/useDiscoverySearch.test.ts
git commit -m "test: verify period-only Discovery search triggers correctly"
```

---

## Phase 2: Unified Degradation Strategy (Tasks 6–10)

### Task 6: Create AppStatus types and context

**Files:**
- Create: `src/contexts/AppStatusContext.tsx`
- Create: `src/hooks/useAppStatus.ts`

**Step 1: Write the type definitions and context**

```typescript
// src/contexts/AppStatusContext.tsx

/**
 * 應用狀態 Context，統一管理降級狀態。
 * 所有頁面透過 useAppStatus() 取得目前的降級狀態。
 */

import { createContext, useContext, useMemo, ReactNode } from "react";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useQuery } from "@tanstack/react-query";
import { checkHealth } from "../api/client";
import { queryKeys } from "../lib/react-query";

/** 應用降級狀態。 */
export type DegradationLevel =
  | "online"           // 一切正常
  | "offline"          // 瀏覽器離線
  | "sidecar-down"     // Sidecar 不可用
  | "rate-limited"     // GitHub API 429
  | "partial-failure"; // 部分 API 失敗但核心功能可用

export interface AppStatus {
  /** 當前降級等級。 */
  level: DegradationLevel;
  /** 是否應顯示全域橫幅。 */
  showBanner: boolean;
  /** 橫幅訊息（i18n key 或直接文字）。 */
  bannerMessage: string | null;
  /** Sidecar 是否可用。 */
  isSidecarUp: boolean;
  /** 是否在線。 */
  isOnline: boolean;
}

const AppStatusContext = createContext<AppStatus | undefined>(undefined);

export function AppStatusProvider({ children }: { children: ReactNode }) {
  const isOnline = useOnlineStatus();

  const healthQuery = useQuery({
    queryKey: queryKeys.dashboard.health,
    queryFn: checkHealth,
    retry: 1,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const isSidecarUp = healthQuery.data?.status === "ok";

  const status = useMemo<AppStatus>(() => {
    if (!isOnline) {
      return {
        level: "offline",
        showBanner: true,
        bannerMessage: "offline",
        isSidecarUp: false,
        isOnline: false,
      };
    }
    if (!isSidecarUp && !healthQuery.isLoading) {
      return {
        level: "sidecar-down",
        showBanner: true,
        bannerMessage: "sidecarDown",
        isSidecarUp: false,
        isOnline: true,
      };
    }
    return {
      level: "online",
      showBanner: false,
      bannerMessage: null,
      isSidecarUp,
      isOnline: true,
    };
  }, [isOnline, isSidecarUp, healthQuery.isLoading]);

  return (
    <AppStatusContext.Provider value={status}>
      {children}
    </AppStatusContext.Provider>
  );
}

export function useAppStatus(): AppStatus {
  const ctx = useContext(AppStatusContext);
  if (!ctx) throw new Error("useAppStatus must be used within AppStatusProvider");
  return ctx;
}
```

**Step 2: Commit**

```bash
git add src/contexts/AppStatusContext.tsx
git commit -m "feat: create AppStatus context with degradation levels"
```

---

### Task 7: Create StatusBanner component

**Files:**
- Create: `src/components/StatusBanner.tsx`
- Modify: `src/App.css` (append styles)
- Modify: `src/i18n/translations.ts` (add keys)

**Step 1: Write the component**

```typescript
// src/components/StatusBanner.tsx

/**
 * 全域狀態橫幅，顯示離線、sidecar 不可用等降級狀態。
 */

import { memo } from "react";
import { useAppStatus, DegradationLevel } from "../contexts/AppStatusContext";
import { useI18n } from "../i18n";

const ICONS: Record<DegradationLevel, string> = {
  online: "",
  offline: "⚡",
  "sidecar-down": "🔌",
  "rate-limited": "⏳",
  "partial-failure": "⚠️",
};

export const StatusBanner = memo(function StatusBanner() {
  const { level, showBanner, bannerMessage } = useAppStatus();
  const { t } = useI18n();

  if (!showBanner || !bannerMessage) return null;

  const message = t.status?.[bannerMessage as keyof typeof t.status] ?? bannerMessage;

  return (
    <div
      className={`status-banner status-banner--${level}`}
      role="alert"
      aria-live="assertive"
    >
      <span className="status-banner-icon">{ICONS[level]}</span>
      <span className="status-banner-message">{message}</span>
    </div>
  );
});
```

**Step 2: Add CSS** (append to `src/App.css`)

```css
/* Status Banner */
.status-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
}

.status-banner--offline {
  background-color: var(--warning-subtle);
  color: var(--warning-fg);
}

.status-banner--sidecar-down {
  background-color: var(--danger-subtle);
  color: var(--danger-fg);
}

.status-banner--rate-limited {
  background-color: var(--attention-subtle);
  color: var(--attention-fg);
}

.status-banner--partial-failure {
  background-color: var(--warning-subtle);
  color: var(--warning-fg);
}
```

**Step 3: Add i18n keys** (both en and zh-TW sections of `translations.ts`)

```typescript
// English
status: {
  offline: "You are offline. Showing cached data.",
  sidecarDown: "Data engine is not running. Please restart the app.",
  rateLimited: "GitHub API rate limit reached. Requests will resume shortly.",
  partialFailure: "Some data could not be loaded.",
},

// Chinese
status: {
  offline: "目前離線，顯示快取資料。",
  sidecarDown: "資料引擎未執行，請重新啟動應用程式。",
  rateLimited: "GitHub API 已達速率限制，稍後將自動恢復。",
  partialFailure: "部分資料無法載入。",
},
```

**Step 4: Commit**

```bash
git add src/components/StatusBanner.tsx src/App.css src/i18n/translations.ts
git commit -m "feat: create StatusBanner for degradation states"
```

---

### Task 8: Integrate AppStatus into App.tsx

**Files:**
- Modify: `src/App.tsx`

**Step 1: Wrap app with AppStatusProvider and add StatusBanner**

In `src/App.tsx`, add the provider and banner:

```typescript
// Add imports
import { AppStatusProvider } from "./contexts/AppStatusContext";
import { StatusBanner } from "./components/StatusBanner";

// In the JSX tree, wrap inside ThemeProvider and add banner before Routes:
<AppStatusProvider>
  <StatusBanner />
  <ErrorBoundary>
    {/* ... existing routes ... */}
  </ErrorBoundary>
</AppStatusProvider>
```

**Step 2: Remove duplicate health check from WatchlistContext**

In `src/contexts/WatchlistContext.tsx`, the health check at line 67-72 duplicates AppStatusContext. Change it to consume `useAppStatus()` instead:

```typescript
// Replace:
const healthQuery = useQuery({ queryKey: queryKeys.dashboard.health, queryFn: checkHealth, ... });
const isConnected = healthQuery.data?.status === "ok";

// With:
const { isSidecarUp: isConnected } = useAppStatus();
```

**Step 3: Commit**

```bash
git add src/App.tsx src/contexts/WatchlistContext.tsx
git commit -m "feat: integrate AppStatus into app root + remove duplicate health check"
```

---

### Task 9: Test — AppStatus context behavior

**Files:**
- Create: `src/contexts/__tests__/AppStatusContext.test.tsx`

**Step 1: Write tests**

```typescript
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "../../lib/react-query";
import { AppStatusProvider, useAppStatus } from "../AppStatusContext";

let mockOnline = true;
vi.mock("../../hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => mockOnline,
}));

vi.mock("../../api/client", () => ({
  checkHealth: vi.fn().mockResolvedValue({ status: "ok" }),
}));

function createWrapper() {
  const client = createTestQueryClient();
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(AppStatusProvider, null, children)
    );
}

describe("AppStatusContext", () => {
  it("returns online when everything is ok", async () => {
    mockOnline = true;
    const { result } = renderHook(() => useAppStatus(), { wrapper: createWrapper() });
    // 初始可能是 loading，等穩定後
    expect(result.current.isOnline).toBe(true);
  });

  it("returns offline when browser is offline", () => {
    mockOnline = false;
    const { result } = renderHook(() => useAppStatus(), { wrapper: createWrapper() });
    expect(result.current.level).toBe("offline");
    expect(result.current.showBanner).toBe(true);
    mockOnline = true;
  });

  it("throws when used outside provider", () => {
    expect(() => {
      renderHook(() => useAppStatus());
    }).toThrow("useAppStatus must be used within AppStatusProvider");
  });
});
```

**Step 2–3: Run and commit**

```bash
npm run test -- --run src/contexts/__tests__/AppStatusContext.test.tsx
git commit -m "test: verify AppStatus degradation level detection"
```

---

### Task 10: Update DataFreshnessBar to use AppStatus

**Files:**
- Modify: `src/components/DataFreshnessBar.tsx`

**Step 1: Replace inline useOnlineStatus with useAppStatus**

```typescript
// Replace:
import { useOnlineStatus } from "../hooks/useOnlineStatus";
// With:
import { useAppStatus } from "../contexts/AppStatusContext";

// In the component:
// Replace: const isOnline = useOnlineStatus();
// With: const { isOnline } = useAppStatus();
```

This ensures the offline indicator is driven by the same source as the global banner.

**Step 2: Commit**

```bash
git add src/components/DataFreshnessBar.tsx
git commit -m "refactor: DataFreshnessBar consumes AppStatus instead of direct useOnlineStatus"
```

---

## Phase 3: Cross-Layer E2E Tests (Tasks 11–14)

### Task 11: E2E — Discovery filter-only search

**Files:**
- Create/Modify: `e2e/discovery-flow.spec.ts`

**Step 1: Add test**

```typescript
test("filter-only search returns results", async ({ page }) => {
  await page.locator('[data-testid="nav-discovery"]').click();

  // 不輸入關鍵字，只選語言篩選
  const langSelect = page.locator('[data-testid="language-filter"]');
  await langSelect.selectOption("Python");

  // 應該觸發搜尋並顯示結果
  await expect(page.locator('[data-testid="discovery-results"]')).toBeVisible({ timeout: 10000 });
  const resultCount = page.locator('[role="status"]');
  await expect(resultCount).not.toContainText("0");
});
```

**Step 2: Commit**

```bash
git add e2e/discovery-flow.spec.ts
git commit -m "test(e2e): verify Discovery filter-only search returns results"
```

---

### Task 12: E2E — Settings persistence after reload

**Files:**
- Modify: `e2e/settings-persistence.spec.ts`

This test already exists partially. Verify it covers:
- Change fetch interval → reload → still changed
- Change snapshot retention → reload → still changed

**Step 1: Review and enhance if needed**

If the existing test is sufficient, skip. Otherwise add signal thresholds test.

**Step 2: Commit if changed**

---

### Task 13: E2E — Status banner shows when sidecar is down

**Files:**
- Create: `e2e/degradation.spec.ts`

**Step 1: Add test**

```typescript
import { test, expect } from "@playwright/test";

test.describe("Degradation", () => {
  test("shows status banner when sidecar health check fails", async ({ page }) => {
    // 攔截 health check 並回傳錯誤
    await page.route("**/api/health", (route) =>
      route.fulfill({ status: 503, body: JSON.stringify({ error: "Service unavailable" }) })
    );

    await page.goto("/");

    // 應顯示降級橫幅
    await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[role="alert"]')).toContainText(/engine|引擎/i);
  });
});
```

**Step 2: Commit**

```bash
git add e2e/degradation.spec.ts
git commit -m "test(e2e): verify status banner when sidecar health check fails"
```

---

### Task 14: Final verification and cleanup

**Step 1: Run all tests**

```bash
npm run type-check
npm run lint
npm run test:coverage
cd sidecar && source .venv/bin/activate && pytest tests/ -v
```

**Step 2: Update CHANGELOG.md**

Add entry to `[Unreleased]`:

```markdown
### 重構與變更

- **Discovery 搜尋 contract 固化** — 統一 filter-only、loadMore 失敗、quick picks 的狀態規則，補充 5 個缺失測試
- **統一降級策略** — AppStatusContext 統一管理 online/offline/sidecar-down/rate-limited/partial-failure 五種降級狀態
- **StatusBanner** — 全域降級狀態橫幅（離線、sidecar 不可用時自動顯示）
- **跨層 E2E** — 新增 Discovery filter-only、降級橫幅 E2E 測試
```

**Step 3: Commit**

```bash
git add -A
git commit -m "docs: update CHANGELOG with Discovery + degradation + E2E improvements"
```

---

## Execution Checklist

| Phase | Task | Estimated | Risk |
|-------|------|-----------|------|
| 1 | Discovery: filter change cancel test | 5m | Low |
| 1 | Discovery: filter-only search test | 5m | Low |
| 1 | Discovery: loadMore failure test | 5m | Low |
| 1 | Discovery: resetSearch test | 5m | Low |
| 1 | Discovery: period-only search test | 5m | Low |
| 2 | AppStatus context + types | 15m | Medium |
| 2 | StatusBanner component | 10m | Low |
| 2 | Integrate into App.tsx | 10m | Medium |
| 2 | AppStatus tests | 10m | Low |
| 2 | DataFreshnessBar refactor | 5m | Low |
| 3 | E2E: filter-only search | 5m | Low |
| 3 | E2E: settings persistence | 5m | Low |
| 3 | E2E: degradation banner | 10m | Medium |
| 3 | Final verification | 10m | Low |

**Total: ~14 tasks, ~105 minutes**

**Dependencies:**
- Phase 2 (Task 8) depends on Phase 2 (Task 6) — AppStatusProvider must exist before integration
- Phase 3 (Task 13) depends on Phase 2 (Task 7) — StatusBanner must exist for E2E to test
- Phase 1 is independent — can start immediately
