---
paths:
  - "src/hooks/**"
  - "src/components/**"
  - "src/pages/**"
  - "src/lib/**"
---

# 前端架構模式

## React Query 資料層

- **QueryClient 設定** (`lib/react-query.ts`) — staleTime 5min、gcTime 30min、retry 1
- **queryKeys 工廠** — 型別安全的 query key 生成器，避免魔術字串
- **Query hooks**:
  - `useReposQuery` — repos 列表查詢（WatchlistContext 內部使用）
  - `useTrends` — Trends 頁面主資料（含 filter 狀態）
  - `useDashboard` — 4 個平行 useQuery（repos、alerts、signals、summary）
- **寫入操作** — 由 `WatchlistContext` actions 統一處理（addRepo / removeRepo / fetchRepo / refreshAll），成功後自動 invalidate React Query cache
- **測試工具** — `createTestQueryClient()` 提供零快取零重試的測試用 QueryClient

## Watchlist Context + useReducer 架構

- `WatchlistContext.tsx` — 資料層由 React Query 管理，Context 只負責 UI 狀態
- 資料來源 — `useReposQuery()` + `useQuery(health)` → 合併進 state context
- State Machine Pattern — `LoadingState` 使用 Discriminated Unions 消除不可能狀態
- Context 分層（優化 re-render）:
  - `WatchlistStateContext` — 只讀狀態（repos 來自 React Query、UI 來自 reducer）
  - `WatchlistActionsContext` — 業務邏輯（mutation + cache invalidation）
- Selector hooks（精準訂閱）:
  - `useFilteredRepos()` — 套用分類 + 搜尋篩選
  - `useLoadingRepo()` — 當前載入的 repo ID
  - `useIsRefreshing()` — 是否正在刷新
  - `useIsRecalculating()` — 是否正在重算相似度
- 測試策略 — Mock Context hooks：`useWatchlistState`, `useWatchlistActions`

## React-Window (虛擬滾動)

- **版本** - `react-window@2.2.5`（v2 API）
- **核心組件** - `List` 需 4 個必要 props：`rowComponent`, `rowCount`, `rowHeight`, `style`（含 height/width）
- **RowComponent 型別** - `RowComponentProps` from `react-window`
- **動態行高** - `rowHeight` 支援函數型式 `(index: number) => number`，用於圖表展開時調整行高
  - 收合：`COLLAPSED_ITEM_SIZE = 296px`（卡片 280 + 間距 16）
  - 展開：`EXPANDED_ITEM_SIZE = 596px`（加上圖表 300px）
- **圖表展開狀態** - 由 `RepoList` 層級的 `expandedCharts: Set<number>` 管理，通過 `chartExpanded` / `onChartToggle` props 傳入 `RepoCard`
- **Memo 優化** - `onChartToggle` 接受 `(repoId: number)` 參數以避免 inline arrow 破壞 `RepoCard` 的 `memo`
- **常見陷阱** - v2 API 使用 `rowComponent` prop（非 v1 的 `children` render prop）；避免直接傳 `itemData` 到 `List`，改用 `rowProps`；避免在 `RowComponent` 中使用 inline arrow 作為 memoized 子元件的 callback
