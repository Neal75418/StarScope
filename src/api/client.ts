/**
 * 與 Python sidecar 通訊的 API client。
 */

import { API_ENDPOINT } from "../config";

// 型別定義
export interface RepoWithSignals {
  id: number;
  owner: string;
  name: string;
  full_name: string;
  url: string;
  description: string | null;
  language: string | null;
  added_at: string;
  updated_at: string;
  stars: number | null;
  forks: number | null;
  stars_delta_7d: number | null;
  stars_delta_30d: number | null;
  velocity: number | null;
  acceleration: number | null;
  trend: number | null; // -1, 0, 1 表示趨勢方向
  last_fetched: string | null;
}

export interface RepoListResponse {
  repos: RepoWithSignals[];
  total: number;
}

export interface RepoCreate {
  owner?: string;
  name?: string;
  url?: string;
}

export interface HealthResponse {
  status: string;
  service: string;
  timestamp: string;
}

// Context Signal 型別（簡化後僅保留 HN）
export interface ContextBadge {
  type: "hn";
  label: string;
  url: string;
  score: number | null;
  is_recent: boolean;
}

export interface ContextBadgesResponse {
  badges: ContextBadge[];
  repo_id: number;
}

export interface ContextSignal {
  id: number;
  signal_type: string;
  external_id: string;
  title: string;
  url: string;
  score: number | null;
  comment_count: number | null;
  author: string | null;
  version_tag: string | null;
  is_prerelease: boolean | null;
  published_at: string | null;
  fetched_at: string;
}

export interface ContextSignalsResponse {
  signals: ContextSignal[];
  total: number;
  repo_id: number;
}

// Commit 活動型別
export interface CommitWeek {
  week_start: string;
  commit_count: number;
}

export interface CommitActivityResponse {
  repo_id: number;
  repo_name: string;
  weeks: CommitWeek[];
  total_commits_52w: number;
  avg_commits_per_week: number;
  last_updated: string | null;
}

export interface CommitActivitySummary {
  repo_id: number;
  total_commits_52w: number;
  avg_commits_per_week: number;
  last_updated: string | null;
}

// 語言統計型別
export interface LanguageBreakdown {
  language: string;
  bytes: number;
  percentage: number;
}

export interface LanguagesResponse {
  repo_id: number;
  repo_name: string;
  languages: LanguageBreakdown[];
  primary_language: string | null;
  total_bytes: number;
  last_updated: string | null;
}

export interface LanguagesSummary {
  repo_id: number;
  primary_language: string | null;
  language_count: number;
  last_updated: string | null;
}

// 星數歷史回填型別
export interface BackfillStatus {
  repo_id: number;
  repo_name: string;
  can_backfill: boolean;
  current_stars: number;
  max_stars_allowed: number;
  has_backfilled_data: boolean;
  backfilled_days: number;
  message: string;
}

export interface BackfillResult {
  repo_id: number;
  repo_name: string;
  success: boolean;
  total_stargazers: number;
  snapshots_created: number;
  earliest_date: string | null;
  latest_date: string | null;
  message: string;
}

export interface StarHistoryPoint {
  date: string;
  stars: number;
}

export interface StarHistoryResponse {
  repo_id: number;
  repo_name: string;
  history: StarHistoryPoint[];
  is_backfilled: boolean;
  total_points: number;
}

// 圖表型別
export interface ChartDataPoint {
  date: string;
  stars: number;
  forks: number;
}

export interface StarsChartResponse {
  repo_id: number;
  repo_name: string;
  time_range: string;
  data_points: ChartDataPoint[];
  min_stars: number;
  max_stars: number;
}

// API 錯誤類別
export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

// 預設請求逾時時間（毫秒）
const DEFAULT_TIMEOUT_MS = 30_000;

// API 呼叫輔助函式
async function apiCall<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_ENDPOINT}${endpoint}`;

  // 透過 AbortController 設定逾時，同時尊重呼叫端提供的 signal
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), DEFAULT_TIMEOUT_MS);

  const callerSignal = options.signal;
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
 * 取得儲存庫的快取 commit 活動。
 */
export async function getCommitActivity(repoId: number): Promise<CommitActivityResponse> {
  return apiCall<CommitActivityResponse>(`/commit-activity/${repoId}`);
}

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
 * 取得儲存庫的快取語言資料。
 */
export async function getLanguages(repoId: number): Promise<LanguagesResponse> {
  return apiCall<LanguagesResponse>(`/languages/${repoId}`);
}

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

// 推薦系統型別

export interface SimilarRepo {
  repo_id: number;
  full_name: string;
  description: string | null;
  language: string | null;
  url: string;
  similarity_score: number;
  shared_topics: string[];
  same_language: boolean;
  topic_score?: number;
  language_score?: number;
  magnitude_score?: number;
}

export interface SimilarReposResponse {
  repo_id: number;
  similar: SimilarRepo[];
  total: number;
}

export interface CalculateSimilaritiesResponse {
  repo_id: number;
  similarities_found: number;
}

export interface RecalculateAllResponse {
  total_repos: number;
  processed: number;
  similarities_found: number;
}

export interface RecommendationStats {
  total_repos: number;
  total_similarity_pairs: number;
  repos_with_recommendations: number;
  average_similarity_score: number;
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

/**
 * 取得推薦系統統計資料。
 */
export async function getRecommendationStats(): Promise<RecommendationStats> {
  return apiCall<RecommendationStats>(`/recommendations/stats`);
}

// 分類型別

export interface Category {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  parent_id: number | null;
  sort_order: number;
  created_at: string;
  repo_count: number;
}

export interface CategoryTreeNode {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  sort_order: number;
  repo_count: number;
  children: CategoryTreeNode[];
}

export interface CategoryTreeResponse {
  tree: CategoryTreeNode[];
  total: number;
}

export interface CategoryCreate {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  parent_id?: number;
}

export interface CategoryUpdate {
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  parent_id?: number | null;
  sort_order?: number;
}

export interface CategoryRepo {
  id: number;
  full_name: string;
  description: string | null;
  language: string | null;
  added_at: string;
}

export interface CategoryReposResponse {
  category_id: number;
  category_name: string;
  repos: CategoryRepo[];
  total: number;
}

export interface RepoCategoriesResponse {
  repo_id: number;
  categories: {
    id: number;
    name: string;
    icon: string | null;
    color: string | null;
    added_at: string | null;
  }[];
  total: number;
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
export async function getCategoryRepos(categoryId: number): Promise<CategoryReposResponse> {
  return apiCall<CategoryReposResponse>(`/categories/${categoryId}/repos`);
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

// 早期信號型別

export type EarlySignalType =
  | "rising_star"
  | "sudden_spike"
  | "breakout"
  | "viral_hn"
  | "release_surge";

export type EarlySignalSeverity = "low" | "medium" | "high";

export interface EarlySignal {
  id: number;
  repo_id: number;
  repo_name: string;
  signal_type: EarlySignalType;
  severity: EarlySignalSeverity;
  description: string;
  velocity_value: number | null;
  star_count: number | null;
  percentile_rank: number | null;
  detected_at: string;
  expires_at: string | null;
  acknowledged: boolean;
  acknowledged_at: string | null;
}

export interface EarlySignalListResponse {
  signals: EarlySignal[];
  total: number;
}

export interface SignalSummary {
  total_active: number;
  by_type: Record<string, number>;
  by_severity: Record<string, number>;
  repos_with_signals: number;
}

export interface DetectionResult {
  repos_scanned: number;
  signals_detected: number;
  by_type: Record<string, number>;
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
export async function acknowledgeAllSignals(
  signalType?: EarlySignalType
): Promise<{ status: string; message: string }> {
  const params = signalType ? `?signal_type=${signalType}` : "";
  return apiCall(`/early-signals/acknowledge-all${params}`, {
    method: "POST",
  });
}

/**
 * 觸發異常偵測。
 */
export async function triggerDetection(): Promise<DetectionResult> {
  return apiCall<DetectionResult>(`/early-signals/detect`, {
    method: "POST",
  });
}

/**
 * 刪除一個早期信號。
 */
export async function deleteSignal(signalId: number): Promise<{ status: string; message: string }> {
  return apiCall(`/early-signals/${signalId}`, {
    method: "DELETE",
  });
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

// ==================== GitHub 驗證型別 ====================

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface PollResponse {
  status: "success" | "pending" | "expired" | "error";
  username?: string;
  error?: string;
  slow_down?: boolean;
  interval?: number; // slow_down 為 true 時使用的新間隔
}

export interface GitHubConnectionStatus {
  connected: boolean;
  username?: string;
  rate_limit_remaining?: number;
  rate_limit_total?: number;
  rate_limit_reset?: number; // 配額重置的 Unix timestamp
  error?: string;
}

export interface DisconnectResponse {
  success: boolean;
  message: string;
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

// ==================== 警報型別 ====================

export interface SignalTypeInfo {
  type: string;
  name: string;
  description: string;
}

export type AlertOperator = ">" | "<" | ">=" | "<=" | "==";

export interface AlertRule {
  id: number;
  name: string;
  description: string | null;
  repo_id: number | null;
  repo_name: string | null;
  signal_type: string;
  operator: AlertOperator;
  threshold: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AlertRuleCreate {
  name: string;
  description?: string;
  repo_id?: number;
  signal_type: string;
  operator: AlertOperator;
  threshold: number;
  enabled?: boolean;
}

export interface AlertRuleUpdate {
  name?: string;
  description?: string;
  repo_id?: number;
  signal_type?: string;
  operator?: AlertOperator;
  threshold?: number;
  enabled?: boolean;
}

export interface TriggeredAlert {
  id: number;
  rule_id: number;
  rule_name: string;
  repo_id: number;
  repo_name: string;
  signal_type: string;
  signal_value: number;
  threshold: number;
  operator: AlertOperator;
  triggered_at: string;
  acknowledged: boolean;
  acknowledged_at: string | null;
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
 * 取得特定警報規則。
 */
export async function getAlertRule(ruleId: number): Promise<AlertRule> {
  return apiCall<AlertRule>(`/alerts/rules/${ruleId}`);
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

// ==================== 探索型別 ====================

export interface DiscoveryRepo {
  id: number;
  full_name: string;
  owner: string;
  name: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  url: string;
  topics: string[];
  created_at: string;
  updated_at: string;
}

export interface SearchResponse {
  repos: DiscoveryRepo[];
  total_count: number;
  page: number;
  per_page: number;
  has_more: boolean;
}

export interface SearchFilters {
  language?: string;
  minStars?: number;
  topic?: string;
  sort?: "stars" | "forks" | "updated";
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
  const params = new URLSearchParams({ q: query, page: String(page) });
  if (filters.language) params.set("language", filters.language);
  if (filters.minStars) params.set("min_stars", String(filters.minStars));
  if (filters.topic) params.set("topic", filters.topic);
  if (filters.sort) params.set("sort", filters.sort);

  return apiCall<SearchResponse>(`/discovery/search?${params}`, { signal });
}
