/**
 * React Query 配置
 *
 * 提供統一的查詢快取、重試邏輯和資料同步策略。
 */

import { QueryClient, matchQuery } from "@tanstack/react-query";
import { BATCH_ADD_FOLLOWUP_INTERVAL_MS, BATCH_ADD_TIMEOUT_MS } from "../constants/api";

/**
 * 建立 QueryClient 實例
 *
 * 配置說明：
 * - staleTime: 5 分鐘內資料視為新鮮，不會觸發背景重新取得
 * - gcTime: 30 分鐘後清除未使用的快取
 * - refetchOnWindowFocus: 關閉視窗重新聚焦時的自動重新取得（避免不必要的請求）
 * - retry: 失敗時重試 1 次（避免過度重試）
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 快取策略
      staleTime: 1000 * 60 * 5, // 5 分鐘
      gcTime: 1000 * 60 * 30, // 30 分鐘（原 cacheTime）

      // 自動重新取得
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: true,

      // 錯誤處理
      retry: 1,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      retry: 0, // Mutation 不重試（避免重複提交）
      // 使用者按下的寫入要馬上知道結果：sidecar 連不上時直接失敗（走各處既有的錯誤提示），
      // 不跟查詢一起暫停排隊——排隊會讓確認對話框關不掉，刪除在使用者忘記之後才突然執行
      networkMode: "always",
    },
  },
});

/**
 * 查詢 key 工廠
 *
 * 提供型別安全的查詢 key 生成器，避免魔術字串。
 */
export const queryKeys = {
  // 「自上次以來」摘要：刻意不放在 dashboard 底下——Dashboard 的 refresh 會 invalidate
  // 整個 dashboard，重抓只會回新項目，會把使用者正在看的這批蓋掉
  digest: {
    session: () => ["digest", "session"] as const,
  },

  // 儲存庫
  repos: {
    all: ["repos"] as const,
    lists: () => [...queryKeys.repos.all, "list"] as const,
    list: (filters: { page?: number; perPage?: number } = {}) =>
      [...queryKeys.repos.lists(), filters] as const,
    details: () => [...queryKeys.repos.all, "detail"] as const,
    detail: (id: number) => [...queryKeys.repos.details(), id] as const,
    archived: () => [...queryKeys.repos.all, "archived"] as const,
    syncStatus: () => [...queryKeys.repos.all, "sync-status"] as const,
    // 分類的數量不算封存的 repo，追蹤名單一變就要重讀：放在 repos 底下，
    // 重取 repo 清單的入口（invalidateTrackedRepos）會一起帶到
    categoryTree: () => [...queryKeys.repos.all, "categories", "tree"] as const,
  },

  // 早期信號
  signals: {
    all: ["signals"] as const,
    lists: () => [...queryKeys.signals.all, "list"] as const,
    list: (filters: { repoId?: number } = {}) => [...queryKeys.signals.lists(), filters] as const,
    batch: (repoIds: number[]) => [...queryKeys.signals.all, "batch", repoIds] as const,
    dashboard: () => [...queryKeys.signals.all, "dashboard"] as const,
    summary: () => [...queryKeys.signals.all, "summary"] as const,
  },

  // 情境徽章
  contextBadges: {
    all: ["contextBadges"] as const,
    batch: (repoIds: number[]) => [...queryKeys.contextBadges.all, "batch", repoIds] as const,
  },

  // 探索
  discovery: {
    all: ["discovery"] as const,
    search: (params: { query: string; filters: Record<string, unknown> }) =>
      [...queryKeys.discovery.all, "search", params] as const,
  },

  // GitHub 認證
  githubAuth: {
    status: ["githubAuth", "status"] as const,
  },

  // 趨勢
  trends: {
    all: ["trends"] as const,
    list: (filters: { sortBy?: string; language?: string; minStars?: number | null } = {}) =>
      [...queryKeys.trends.all, "list", filters] as const,
  },

  // 儀表板
  dashboard: {
    all: ["dashboard"] as const,
    weeklySummary: (days: number = 7) =>
      [...queryKeys.dashboard.all, "weeklySummary", days] as const,
    portfolioHistory: (days: number = 30) =>
      [...queryKeys.dashboard.all, "portfolioHistory", days] as const,
  },

  // 警報
  alerts: {
    all: ["alerts"] as const,
    rules: () => [...queryKeys.alerts.all, "rules"] as const,
    triggered: () => [...queryKeys.alerts.all, "triggered"] as const,
    signalTypes: () => [...queryKeys.alerts.all, "signalTypes"] as const,
  },

  // 對比
  comparison: {
    all: ["comparison"] as const,
    chart: (repoIds: number[], timeRange: string, normalize: boolean) =>
      [...queryKeys.comparison.all, "chart", repoIds, timeRange, normalize] as const,
  },

  // 推薦
  recommendations: {
    all: ["recommendations"] as const,
    personalized: (limit: number) =>
      [...queryKeys.recommendations.all, "personalized", limit] as const,
  },

  // 通知
  notifications: {
    all: ["notifications"] as const,
    polling: () => [...queryKeys.notifications.all, "polling"] as const,
  },

  // 回填
  backfill: {
    all: ["backfill"] as const,
    status: (repoId: number) => [...queryKeys.backfill.all, "status", repoId] as const,
  },

  // 連線
  connection: {
    all: ["connection"] as const,
    status: () => [...queryKeys.connection.all, "status"] as const,
  },

  // 星數圖表
  starsChart: {
    all: ["starsChart"] as const,
    /** 一個 repo 所有範圍的圖表（含「全部」）：失效時用這個前綴 */
    repo: (repoId: number) => [...queryKeys.starsChart.all, "data", repoId] as const,
    data: (repoId: number, timeRange: string) =>
      [...queryKeys.starsChart.repo(repoId), timeRange] as const,
  },

  // Repo 卡片資料
  repoCard: {
    all: ["repoCard"] as const,
    badges: (repoId: number) => [...queryKeys.repoCard.all, "badges", repoId] as const,
    signals: (repoId: number) => [...queryKeys.repoCard.all, "signals", repoId] as const,
  },

  // 設定
  settings: {
    all: ["settings"] as const,
    snapshotRetention: () => [...queryKeys.settings.all, "snapshotRetention"] as const,
    fetchInterval: () => [...queryKeys.settings.all, "fetchInterval"] as const,
    signalThresholds: () => [...queryKeys.settings.all, "signalThresholds"] as const,
  },

  // 警報規則資料
  alertRuleData: {
    all: ["alertRuleData"] as const,
    rules: () => [...queryKeys.alertRuleData.all, "rules"] as const,
    signalTypes: () => [...queryKeys.alertRuleData.all, "signalTypes"] as const,
    repos: () => [...queryKeys.alertRuleData.all, "repos"] as const,
  },

  // For You Feed
  feed: {
    all: ["feed"] as const,
    today: () => [...queryKeys.feed.all, "today"] as const,
    stats: () => [...queryKeys.feed.all, "stats"] as const,
  },

  // 興趣（For You Feed）
  interests: {
    all: ["interests"] as const,
    list: () => [...queryKeys.interests.all, "list"] as const,
    exclusions: () => [...queryKeys.interests.all, "exclusions"] as const,
    trending: () => [...queryKeys.interests.all, "trending"] as const,
  },
} as const;

/**
 * 重取 repo 清單。要重取時用這支，不要只 invalidate repos.all：
 * 警報規則看不看得到跟著 repo 走（後端把綁在封存 repo 上的規則當成不存在），
 * 規則清單留著舊資料的話，切換、編輯、刪除那條規則都會 404，復原的 repo 的規則也不會回來。
 * 兩份規則快取都要重取（設定頁的規則清單、Dashboard 判斷有沒有規則用的那份）。
 * 分類樹在 repos 前綴底下會一起重讀（分類成員就是各 repo 的 category_ids）；沒有畫面顯示的分類樹也先在背景重讀，
 * 回到 Watchlist 或 Dashboard 時第一眼就是新的數量。早期訊號同理不算封存的 repo，
 * 取消追蹤或復原之後「有訊號」要跟著變。已觸發警報也是（封存的不列、永久刪除連帶刪掉），見 invalidateTriggeredAlerts。
 * 同步狀態（repos.syncStatus）也在 repos 底下、預設一起重讀；exceptSyncStatus 給偵測背景變化的那支（useBackgroundStarSync）用：
 * 它靠同步狀態發現變化，跟著重讀的話，抓取逐筆寫快照的那幾秒裡會讀到新的值、又觸發一次
 */
export function invalidateTrackedRepos(
  client: QueryClient,
  options: { exceptSyncStatus?: boolean } = {}
): void {
  // 還在第一次載入的分類查詢，請求是寫入前讀的：沒有資料時 React Query 不中止它，invalidate 只會
  // 併進去，帶回舊資料還把這次重讀的標記清掉。先中止（回復原狀態，不算失敗）再 invalidate，
  // 進行中的請求已經是 rejected，下一行才會發新的請求——順序不能對調
  void client.cancelQueries({ queryKey: [...queryKeys.repos.all, "categories"] });
  void client.invalidateQueries({
    queryKey: queryKeys.repos.all,
    // 用 matchQuery 比，不自己算 hash：它照每個查詢自己的 queryKeyHashFn 比對
    ...(options.exceptSyncStatus && {
      predicate: (query) =>
        !matchQuery({ queryKey: queryKeys.repos.syncStatus(), exact: true }, query),
    }),
  });
  void client.refetchQueries({ queryKey: queryKeys.repos.categoryTree(), type: "inactive" });
  void client.invalidateQueries({ queryKey: queryKeys.signals.all });
  void client.invalidateQueries({ queryKey: queryKeys.alertRuleData.rules() });
  void client.invalidateQueries({ queryKey: queryKeys.alerts.rules() });
  void invalidateTriggeredAlerts(client);
}

/**
 * 重讀已觸發警報。有兩份快取：鈴鐺（一分鐘輪詢一次）與 Dashboard（啟用中的警報數、近期活動；不輪詢，掛著時不會自己重讀，
 * 離開再回來也要過了 5 分鐘才重讀）。改到它的寫入之後兩份都要重讀：刪改規則（觸發紀錄跟著刪、標題是規則名）、立即檢查、
 * 封存或刪掉 repo（見 invalidateTrackedRepos）、通知中心的確認與清除。畫面上有的重讀結束（成功或失敗）才 resolve，
 * 不會 reject；沒有的只標成過期，下次掛上時重讀；呼叫當下已經暫停的（sidecar 連不上）不等。例外：Dashboard 那份還沒有
 * 資料、或已經不在畫面上時，鈴鐺讀到新警報會取消它還在路上的讀取（在畫面上就重來，不在就等下次掛上；見
 * useNotificationPolling），這裡會在重讀結束前就 resolve
 */
export async function invalidateTriggeredAlerts(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.notifications.polling() }),
    client.invalidateQueries({ queryKey: queryKeys.alerts.triggered() }),
  ]);
}

/**
 * 最近一次「有結果的」讀取是不是失敗了。畫面上的錯誤訊息與重試鈕看這個，不要只看 isError。
 *
 * 已經有資料時，isError 會一路留到下一次成功。還沒有資料時不會：重試或輪詢一開始 React Query 就把
 * error 清掉、狀態改回 pending——只看 isError 的話，錯誤訊息與重試鈕在重試期間會消失（焦點跟著離開），
 * 輪詢每失敗一次又重新掛上一次。所以「還沒有資料、而且失敗過」也算：errorUpdateCount 在開始讀取時
 * 不會歸零。不拿 errorUpdatedAt／dataUpdatedAt 比大小：那是系統時間，往回調之後成功的讀取會比失敗的那次早。
 */
export function lastLoadFailed(query: {
  isError: boolean;
  isPending: boolean;
  errorUpdateCount: number;
}): boolean {
  return query.isError || (query.isPending && query.errorUpdateCount > 0);
}

/**
 * 讀取進行中，或在等連線恢復。重試鈕要不要顯示成「重試中」看這個，不要看 isFetching：
 * sidecar 斷線時按重試，讀取是暫停的（isFetching 為 false），連上後會自己接著讀——
 * 這段時間按鈕看起來還能按的話，再按也不會有任何反應。
 */
export function loadInProgress(query: { fetchStatus: "fetching" | "paused" | "idle" }): boolean {
  return query.fetchStatus !== "idle";
}

/** 一個區塊的資料讀取狀態：畫面依它決定顯示骨架、「讀不到＋重試」、空狀態或內容 */
export interface LoadStatus {
  /** 已經讀到過資料。之後重讀失敗也還是 true（畫面上是上一次讀到的） */
  ready: boolean;
  /** 最近一次有結果的讀取失敗了（見 lastLoadFailed） */
  failed: boolean;
  /** 讀取進行中，或在等連線恢復（見 loadInProgress） */
  inProgress: boolean;
  retry: () => void;
}

/**
 * 把一個查詢整理成 LoadStatus。要在 render 裡呼叫：React Query 只在 render 當下讀過的欄位改變時
 * 才重新渲染，在事件處理或 effect 裡才讀的話，畫面不會跟著更新。
 */
export function loadStatus(query: {
  data: unknown;
  isError: boolean;
  isPending: boolean;
  errorUpdateCount: number;
  fetchStatus: "fetching" | "paused" | "idle";
  refetch: () => unknown;
}): LoadStatus {
  return {
    ready: query.data !== undefined,
    failed: lastLoadFailed(query),
    inProgress: loadInProgress(query),
    retry: () => void query.refetch(),
  };
}

/**
 * 一個區塊同時靠好幾個查詢時合起來看：都讀到才算 ready，有一個讀不到就算 failed；重試只重讀失敗的那幾個。
 * 有讀不到的時候，inProgress 只看失敗的那幾個，而且要每一個都在重讀才算：重試鈕在 inProgress 時
 * 顯示「重試中」並不吃點擊，只要還有一份讀不到的沒有人在重讀，按鈕就得能按。
 * 沒失敗的查詢不算進來——它們常因為別的原因在背景重讀。
 */
export function combineLoadStatus(parts: LoadStatus[]): LoadStatus {
  const failedParts = parts.filter((part) => part.failed);
  return {
    ready: parts.every((part) => part.ready),
    failed: failedParts.length > 0,
    inProgress:
      failedParts.length > 0
        ? failedParts.every((part) => part.inProgress)
        : parts.some((part) => part.inProgress),
    retry: () => {
      for (const part of failedParts) part.retry();
    },
  };
}

declare const instanceMutationKey: unique symbol;

/**
 * 帶元件實例 useId 的 mutationKey，只能由 useInstanceMutationKey 產生：resetUnlessRunning 只收它，
 * 傳共用的 key 常數就是型別錯誤（理由見 resetUnlessRunning）
 */
export type InstanceMutationKey = readonly string[] & { readonly [instanceMutationKey]: true };

/**
 * 清掉某個 mutation 的結果（資料與錯誤），但它還在跑就不動：reset() 會把 hook 從那次請求上拆下來，按鈕提早恢復、
 * 之後失敗也不會顯示。要問 mutation cache，不看渲染當下的 isPending：React Query 以 setTimeout(0) 才通知畫面，
 * 剛結束時渲染出來的值還是 true（或剛開始時還是 false）。mutationKey 要用 useInstanceMutationKey：
 * 元件卸載再掛上時，舊實例的請求還在 cache 裡，只看共用的 key 會把它算進去
 */
export function resetUnlessRunning(
  queryClient: QueryClient,
  mutationKey: InstanceMutationKey,
  reset: () => void
): void {
  if (queryClient.isMutating({ mutationKey: [...mutationKey] }) === 0) reset();
}

/**
 * 寫入請求逾時後，在伺服器做完之前定期重讀（間隔與期限見 BATCH_ADD_FOLLOWUP_INTERVAL_MS）。
 * 逾時當下伺服器多半還在做，而追蹤清單頁與探索頁讀的是 App 層那份不會重新掛載的查詢、切頁不會重讀：
 * 只讀一次會停在做完之前的樣子。
 * 傳進來的 refetch 要在呼叫端卸載之後仍然有效（用 queryClient 或 app 層 context 的動作），計時器不會跟著停。
 */
export function keepRefetchingAfterTimeout(refetch: () => void): void {
  let elapsed = 0;
  const timer = setInterval(() => {
    elapsed += BATCH_ADD_FOLLOWUP_INTERVAL_MS;
    refetch();
    if (elapsed >= BATCH_ADD_TIMEOUT_MS) clearInterval(timer);
  }, BATCH_ADD_FOLLOWUP_INTERVAL_MS);
}

/**
 * 建立測試用的 QueryClient（不重試、不快取）。
 */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
        // 與正式版一致（見上方 queryClient）
        networkMode: "always",
      },
    },
  });
}
