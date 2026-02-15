/**
 * 與 Python sidecar 通訊的 API client。
 */

import { API_ENDPOINT } from "../config";
import { GITHUB_SEARCH_PAGE_SIZE } from "../constants/api";
import { ApiError } from "./types";
import type {
  RepoWithSignals,
  RepoListResponse,
  RepoCreate,
  HealthResponse,
  ContextBadgesResponse,
  ContextSignalsResponse,
  CommitActivityResponse,
  CommitActivitySummary,
  LanguagesResponse,
  LanguagesSummary,
  BackfillStatus,
  BackfillResult,
  StarHistoryResponse,
  StarsChartResponse,
  SimilarReposResponse,
  CalculateSimilaritiesResponse,
  RecalculateAllResponse,
  Category,
  CategoryTreeResponse,
  CategoryCreate,
  CategoryUpdate,
  CategoryReposResponse,
  RepoCategoriesResponse,
  EarlySignalListResponse,
  SignalSummary,
  TrendsResponse,
  DeviceCodeResponse,
  PollResponse,
  GitHubConnectionStatus,
  DisconnectResponse,
  SignalTypeInfo,
  AlertRule,
  AlertRuleCreate,
  AlertRuleUpdate,
  TriggeredAlert,
  SearchResponse,
  SearchFilters,
  EarlySignalType,
  EarlySignalSeverity,
} from "./types";

export * from "./types";

// 預設請求逾時時間（毫秒）
const DEFAULT_TIMEOUT_MS = 30_000;

// 重試設定
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

// 單次 API 請求（無重試）
async function doFetch<T>(
  url: string,
  options: RequestInit,
  callerSignal?: AbortSignal | null
): Promise<T> {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), DEFAULT_TIMEOUT_MS);

  if (callerSignal) {
    callerSignal.addEventListener("abort", () => timeoutController.abort(), { once: true });
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      signal: timeoutController.signal,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      if (callerSignal?.aborted) {
        throw new ApiError(0, "Request cancelled");
      }
      throw new ApiError(0, "Request timed out");
    }
    throw new ApiError(0, `Network error: ${error instanceof Error ? error.message : "Unknown"}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Unknown error" }));
    throw new ApiError(response.status, error.detail || `HTTP ${response.status}`);
  }

  // 處理 204 No Content 回應
  if (response.status === 204) {
    return null as T;
  }

  return response.json();
}

// API 呼叫輔助函式（含重試）
async function apiCall<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_ENDPOINT}${endpoint}`;
  const callerSignal = options.signal ?? null;
  let lastError: ApiError | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await doFetch<T>(url, options, callerSignal);
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError(0, String(error));
      // 4xx 錯誤不重試（客戶端錯誤）
      if (apiError.status > 0 && apiError.status < 500) throw apiError;
      // 使用者取消不重試
      if (callerSignal?.aborted) throw apiError;
      lastError = apiError;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError ?? new ApiError(0, "Request failed after retries");
}

// API 函式

/**
 * 檢查 sidecar 是否運行中。
 */
export async function checkHealth(): Promise<HealthResponse> {
  return apiCall<HealthResponse>("/health");
}

/**
 * 取得追蹤清單中所有儲存庫。
 */
export async function getRepos(): Promise<RepoListResponse> {
  return apiCall<RepoListResponse>("/repos");
}

/**
 * 新增儲存庫至追蹤清單。
 */
export async function addRepo(input: RepoCreate): Promise<RepoWithSignals> {
  return apiCall<RepoWithSignals>("/repos", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * 從追蹤清單移除儲存庫。
 */
export async function removeRepo(repoId: number): Promise<void> {
  return apiCall<void>(`/repos/${repoId}`, {
    method: "DELETE",
  });
}

/**
 * 取得儲存庫的最新資料。
 */
export async function fetchRepo(repoId: number): Promise<RepoWithSignals> {
  return apiCall<RepoWithSignals>(`/repos/${repoId}/fetch`, {
    method: "POST",
  });
}

/**
 * 取得所有儲存庫的最新資料。
 */
export async function fetchAllRepos(): Promise<RepoListResponse> {
  return apiCall<RepoListResponse>("/repos/fetch-all", {
    method: "POST",
  });
}

// Context Signal API 函式

/**
 * 取得儲存庫的 context badge。
 */
export async function getContextBadges(repoId: number): Promise<ContextBadgesResponse> {
  return apiCall<ContextBadgesResponse>(`/context/${repoId}/badges`);
}

/**
 * 批次取得多個儲存庫的 context badge。
 */
export async function getContextBadgesBatch(
  repoIds: number[]
): Promise<Record<string, ContextBadgesResponse>> {
  const res = await apiCall<{ results: Record<string, ContextBadgesResponse> }>(
    "/context/badges/batch",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo_ids: repoIds }),
    }
  );
  return res.results;
}

/**
 * 取得儲存庫的所有 context signal。
 */
export async function getContextSignals(
  repoId: number,
  signalType?: string
): Promise<ContextSignalsResponse> {
  const params = signalType ? `?signal_type=${signalType}` : "";
  return apiCall<ContextSignalsResponse>(`/context/${repoId}/signals${params}`);
}

/**
 * 手動觸發儲存庫的 context signal 抓取。
 */
export async function fetchRepoContext(
  repoId: number
): Promise<{ repo_id: number; new_signals: Record<string, number> }> {
  return apiCall(`/context/${repoId}/fetch`, {
    method: "POST",
  });
}

// 圖表 API 函式

/**
 * 取得儲存庫的星數歷史圖表資料。
 */
export async function getStarsChart(
  repoId: number,
  timeRange: "7d" | "30d" | "90d" = "30d"
): Promise<StarsChartResponse> {
  return apiCall<StarsChartResponse>(`/charts/${repoId}/stars?time_range=${timeRange}`);
}

// Commit 活動 API 函式

/**
 * 從 GitHub 抓取（或重新整理）commit 活動。
 */
export async function fetchCommitActivity(repoId: number): Promise<CommitActivityResponse> {
  return apiCall<CommitActivityResponse>(`/commit-activity/${repoId}/fetch`, {
    method: "POST",
  });
}

/**
 * 取得簡要 commit 活動摘要（供 badge/card 使用）。
 */
export async function getCommitActivitySummary(repoId: number): Promise<CommitActivitySummary> {
  return apiCall<CommitActivitySummary>(`/commit-activity/${repoId}/summary`);
}

// 語言統計 API 函式

/**
 * 從 GitHub 抓取（或重新整理）語言資料。
 */
export async function fetchLanguages(repoId: number): Promise<LanguagesResponse> {
  return apiCall<LanguagesResponse>(`/languages/${repoId}/fetch`, {
    method: "POST",
  });
}

/**
 * 取得簡要語言摘要（供 badge/card 使用）。
 */
export async function getLanguagesSummary(repoId: number): Promise<LanguagesSummary> {
  return apiCall<LanguagesSummary>(`/languages/${repoId}/summary`);
}

// 星數歷史回填 API 函式

/**
 * 檢查儲存庫是否符合星數歷史回填資格。
 */
export async function getBackfillStatus(repoId: number): Promise<BackfillStatus> {
  return apiCall<BackfillStatus>(`/star-history/${repoId}/status`);
}

/**
 * 回填儲存庫的星數歷史（僅限 < 5000 星的儲存庫）。
 */
export async function backfillStarHistory(repoId: number): Promise<BackfillResult> {
  return apiCall<BackfillResult>(`/star-history/${repoId}/backfill`, {
    method: "POST",
  });
}

/**
 * 取得儲存庫的完整星數歷史。
 */
export async function getStarHistory(repoId: number): Promise<StarHistoryResponse> {
  return apiCall<StarHistoryResponse>(`/star-history/${repoId}`);
}

// 推薦系統 API 函式

/**
 * 取得指定儲存庫的相似儲存庫。
 */
export async function getSimilarRepos(
  repoId: number,
  limit: number = 10
): Promise<SimilarReposResponse> {
  return apiCall<SimilarReposResponse>(`/recommendations/similar/${repoId}?limit=${limit}`);
}

/**
 * 計算指定儲存庫的相似度。
 */
export async function calculateRepoSimilarities(
  repoId: number
): Promise<CalculateSimilaritiesResponse> {
  return apiCall<CalculateSimilaritiesResponse>(`/recommendations/repo/${repoId}/calculate`, {
    method: "POST",
  });
}

/**
 * 重新計算所有儲存庫的相似度。
 */
export async function recalculateAllSimilarities(): Promise<RecalculateAllResponse> {
  return apiCall<RecalculateAllResponse>(`/recommendations/recalculate`, {
    method: "POST",
  });
}

// 分類 API 函式

/**
 * 以樹狀結構取得分類。
 */
export async function getCategoryTree(): Promise<CategoryTreeResponse> {
  return apiCall<CategoryTreeResponse>(`/categories/tree`);
}

/**
 * 取得特定分類。
 */
export async function getCategory(categoryId: number): Promise<Category> {
  return apiCall<Category>(`/categories/${categoryId}`);
}

/**
 * 建立新分類。
 */
export async function createCategory(data: CategoryCreate): Promise<Category> {
  return apiCall<Category>(`/categories`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * 更新分類。
 */
export async function updateCategory(categoryId: number, data: CategoryUpdate): Promise<Category> {
  return apiCall<Category>(`/categories/${categoryId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

/**
 * 刪除分類。
 */
export async function deleteCategory(
  categoryId: number
): Promise<{ status: string; message: string }> {
  return apiCall(`/categories/${categoryId}`, {
    method: "DELETE",
  });
}

/**
 * 取得分類中的儲存庫。
 */
export async function getCategoryRepos(
  categoryId: number,
  signal?: AbortSignal
): Promise<CategoryReposResponse> {
  return apiCall<CategoryReposResponse>(`/categories/${categoryId}/repos`, { signal });
}

/**
 * 將儲存庫加入分類。
 */
export async function addRepoToCategory(
  categoryId: number,
  repoId: number
): Promise<{ status: string; message: string }> {
  return apiCall(`/categories/${categoryId}/repos/${repoId}`, {
    method: "POST",
  });
}

/**
 * 從分類移除儲存庫。
 */
export async function removeRepoFromCategory(
  categoryId: number,
  repoId: number
): Promise<{ status: string; message: string }> {
  return apiCall(`/categories/${categoryId}/repos/${repoId}`, {
    method: "DELETE",
  });
}

/**
 * 取得儲存庫所屬的分類。
 */
export async function getRepoCategories(repoId: number): Promise<RepoCategoriesResponse> {
  return apiCall<RepoCategoriesResponse>(`/categories/repo/${repoId}/categories`);
}

// 早期信號 API 函式

/**
 * 列出所有早期信號。
 */
export async function listEarlySignals(options?: {
  signal_type?: EarlySignalType;
  severity?: EarlySignalSeverity;
  include_acknowledged?: boolean;
  include_expired?: boolean;
  limit?: number;
}): Promise<EarlySignalListResponse> {
  const params = new URLSearchParams();
  if (options?.signal_type) params.append("signal_type", options.signal_type);
  if (options?.severity) params.append("severity", options.severity);
  if (options?.include_acknowledged) params.append("include_acknowledged", "true");
  if (options?.include_expired) params.append("include_expired", "true");
  if (options?.limit) params.append("limit", String(options.limit));

  const queryString = params.toString();
  return apiCall<EarlySignalListResponse>(`/early-signals/${queryString ? `?${queryString}` : ""}`);
}

/**
 * 取得特定儲存庫的早期信號。
 */
export async function getRepoSignals(
  repoId: number,
  options?: {
    include_acknowledged?: boolean;
    include_expired?: boolean;
  }
): Promise<EarlySignalListResponse> {
  const params = new URLSearchParams();
  if (options?.include_acknowledged) params.append("include_acknowledged", "true");
  if (options?.include_expired) params.append("include_expired", "true");

  const queryString = params.toString();
  return apiCall<EarlySignalListResponse>(
    `/early-signals/repo/${repoId}${queryString ? `?${queryString}` : ""}`
  );
}

/**
 * 批次取得多個儲存庫的早期信號。
 */
export async function getRepoSignalsBatch(
  repoIds: number[]
): Promise<Record<string, EarlySignalListResponse>> {
  const res = await apiCall<{ results: Record<string, EarlySignalListResponse> }>(
    "/early-signals/batch",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo_ids: repoIds }),
    }
  );
  return res.results;
}

/**
 * 取得信號摘要統計。
 */
export async function getSignalSummary(): Promise<SignalSummary> {
  return apiCall<SignalSummary>(`/early-signals/summary`);
}

/**
 * 確認（acknowledge）一個信號。
 */
export async function acknowledgeSignal(
  signalId: number
): Promise<{ status: string; message: string }> {
  return apiCall(`/early-signals/${signalId}/acknowledge`, {
    method: "POST",
  });
}

/**
 * 確認所有信號。
 */
// ==================== 趨勢 API ====================

/**
 * 取得趨勢儲存庫排行。
 */
export async function getTrends(params: {
  sortBy: string;
  limit: number;
  language?: string;
  minStars?: number | null;
}): Promise<TrendsResponse> {
  const query = new URLSearchParams({
    sort_by: params.sortBy,
    limit: String(params.limit),
  });
  if (params.language) query.set("language", params.language);
  if (params.minStars != null) query.set("min_stars", String(params.minStars));
  return apiCall<TrendsResponse>(`/trends/?${query}`);
}

// ==================== 匯出 API ====================

/**
 * 取得追蹤清單 JSON 的匯出下載 URL。
 */
export function getExportWatchlistJsonUrl(): string {
  return `${API_ENDPOINT}/export/watchlist.json`;
}

/**
 * 取得追蹤清單 CSV 的匯出下載 URL。
 */
export function getExportWatchlistCsvUrl(): string {
  return `${API_ENDPOINT}/export/watchlist.csv`;
}

// ==================== GitHub 驗證 API 函式 ====================

/**
 * 啟動 GitHub Device Flow 驗證。
 * 回傳 device code 與 user code 供使用者在 GitHub 上輸入。
 */
export async function initiateDeviceFlow(): Promise<DeviceCodeResponse> {
  return apiCall<DeviceCodeResponse>(`/github-auth/device-code`, {
    method: "POST",
  });
}

/**
 * 在 Device Flow 期間輪詢授權狀態。
 * 定期呼叫直到 status 為 "success" 或 "error"/"expired"。
 */
export async function pollAuthorization(deviceCode: string): Promise<PollResponse> {
  return apiCall<PollResponse>(`/github-auth/poll`, {
    method: "POST",
    body: JSON.stringify({ device_code: deviceCode }),
  });
}

/**
 * 取得目前 GitHub 連線狀態。
 */
export async function getGitHubConnectionStatus(): Promise<GitHubConnectionStatus> {
  return apiCall<GitHubConnectionStatus>(`/github-auth/status`);
}

/**
 * 移除已儲存的憑證以中斷 GitHub 連線。
 */
export async function disconnectGitHub(): Promise<DisconnectResponse> {
  return apiCall<DisconnectResponse>(`/github-auth/disconnect`, {
    method: "POST",
  });
}

// ==================== 警報 API 函式 ====================

/**
 * 列出警報規則可用的信號類型。
 */
export async function listSignalTypes(): Promise<SignalTypeInfo[]> {
  return apiCall<SignalTypeInfo[]>(`/alerts/signal-types`);
}

/**
 * 列出所有警報規則。
 */
export async function listAlertRules(): Promise<AlertRule[]> {
  return apiCall<AlertRule[]>(`/alerts/rules`);
}

/**
 * 建立新警報規則。
 */
export async function createAlertRule(data: AlertRuleCreate): Promise<AlertRule> {
  return apiCall<AlertRule>(`/alerts/rules`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * 更新警報規則。
 */
export async function updateAlertRule(ruleId: number, data: AlertRuleUpdate): Promise<AlertRule> {
  return apiCall<AlertRule>(`/alerts/rules/${ruleId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/**
 * 刪除警報規則。
 */
export async function deleteAlertRule(ruleId: number): Promise<{ status: string; id: number }> {
  return apiCall(`/alerts/rules/${ruleId}`, {
    method: "DELETE",
  });
}

/**
 * 列出已觸發的警報。
 */
export async function listTriggeredAlerts(
  unacknowledgedOnly: boolean = false,
  limit: number = 50
): Promise<TriggeredAlert[]> {
  const params = new URLSearchParams();
  if (unacknowledgedOnly) params.append("unacknowledged_only", "true");
  params.append("limit", String(limit));
  return apiCall<TriggeredAlert[]>(`/alerts/triggered?${params}`);
}

/**
 * 確認一個已觸發的警報。
 */
export async function acknowledgeTriggeredAlert(
  alertId: number
): Promise<{ status: string; id: number }> {
  return apiCall(`/alerts/triggered/${alertId}/acknowledge`, {
    method: "POST",
  });
}

/**
 * 確認所有未確認的警報。
 */
export async function acknowledgeAllTriggeredAlerts(): Promise<{ status: string; count: number }> {
  return apiCall(`/alerts/triggered/acknowledge-all`, {
    method: "POST",
  });
}

/**
 * 手動觸發警報檢查。
 */
export async function checkAlerts(): Promise<{
  status: string;
  triggered_count: number;
  triggered: { id: number; rule_id: number; repo_id: number; signal_value: number }[];
}> {
  return apiCall(`/alerts/check`, {
    method: "POST",
  });
}

// ==================== 探索 API 函式 ====================

/**
 * 使用 GitHub Search API 搜尋儲存庫。
 */
export async function searchRepos(
  query: string,
  filters: SearchFilters = {},
  page: number = 1,
  signal?: AbortSignal
): Promise<SearchResponse> {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    per_page: String(GITHUB_SEARCH_PAGE_SIZE),
  });
  if (filters.language) params.set("language", filters.language);
  if (filters.minStars) params.set("min_stars", String(filters.minStars));
  if (filters.topic) params.set("topic", filters.topic);
  if (filters.sort) params.set("sort", filters.sort);

  return apiCall<SearchResponse>(`/discovery/search?${params}`, { signal });
}
