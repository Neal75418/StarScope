/**
 * API 型別定義。
 * 所有與 Python sidecar 通訊的介面型別集中在此。
 */

// 基礎型別

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
  /** 單日 star 變化量。七日快照尚未累積時，「在動」面板改用這個窗口 */
  stars_delta_1d: number | null;
  stars_delta_7d: number | null;
  stars_delta_30d: number | null;
  velocity: number | null;
  acceleration: number | null;
  trend: number | null; // -1, 0, 1 表示趨勢方向
  forks_delta_7d: number | null;
  forks_delta_30d: number | null;
  issues_delta_7d: number | null;
  issues_delta_30d: number | null;
  last_fetched: string | null;
}

export interface RepoListResponse {
  repos: RepoWithSignals[];
  total: number;
  page?: number | null;
  per_page?: number | null;
  total_pages?: number | null;
}

export interface RepoCreate {
  owner?: string;
  name?: string;
  url?: string;
}

export interface BatchImportResult {
  total: number;
  success: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export interface HealthResponse {
  status: string;
  service: string;
  timestamp: string;
}

// Context Signal 型別

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
  published_at: string | null;
  fetched_at: string;
}

export interface ContextSignalsResponse {
  signals: ContextSignal[];
  total: number;
  repo_id: number;
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
  /** 正規化且基期為 0 時為 null——算不出百分比，圖表要斷線而不是畫成 0 */
  stars: number | null;
  forks: number | null;
  open_issues: number | null;
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
    public detail: string,
    public code: string | null = null,
    public details: unknown = null
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

// 推薦系統型別

export interface RecalculateAllResponse {
  total_repos: number;
  processed: number;
  similarities_found: number;
}

// 個人化推薦型別

export interface PersonalizedRecommendation {
  repo_id: number;
  full_name: string;
  description: string | null;
  language: string | null;
  url: string;
  stars: number | null;
  velocity: number | null;
  trend: number | null;
  similarity_score: number;
  shared_topics: string[];
  same_language: boolean;
  source_repo_id: number;
  source_repo_name: string;
}

export interface PersonalizedResponse {
  recommendations: PersonalizedRecommendation[];
  total: number;
  based_on_repos: number;
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

// 早期信號型別

export type EarlySignalType = "rising_star" | "sudden_spike" | "breakout" | "viral_hn";

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

// 趨勢型別

export interface TrendingRepo {
  id: number;
  owner: string;
  name: string;
  full_name: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number | null;
  stars_delta_7d: number | null;
  stars_delta_30d: number | null;
  velocity: number | null;
  acceleration: number | null;
  trend: number | null;
  forks_delta_7d: number | null;
  forks_delta_30d: number | null;
  issues_delta_7d: number | null;
  issues_delta_30d: number | null;
  rank: number;
}

export interface TrendsResponse {
  repos: TrendingRepo[];
  total: number;
  sort_by: string;
  /**
   * 目前完全沒有訊號的排序鍵。按下去只會得到空榜單，而空狀態的文案講的是
   * 「放寬語言或最低星數」，對這個情境是錯的建議——真正的原因是歷史資料還不夠。
   */
  empty_sorts: string[];
}

// GitHub 驗證型別

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

// 警報型別

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

// 探索型別

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
  owner_avatar_url: string | null;
  open_issues_count: number;
  license_spdx: string | null;
  license_name: string | null;
  archived: boolean;
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
  maxStars?: number;
  topic?: string;
  sort?: "stars" | "forks" | "updated";
  order?: "asc" | "desc";
  license?: string;
  hideArchived?: boolean;
}

// 週報摘要型別

export interface WeeklyRepoSummary {
  repo_id: number;
  full_name: string;
  stars: number;
  stars_delta_7d: number;
  velocity: number;
  trend: number;
}

export interface WeeklyHNMention {
  repo_id: number;
  repo_name: string;
  hn_title: string;
  hn_score: number;
  hn_url: string;
}

export interface WeeklyRelease {
  repo_id: number;
  repo_name: string;
  /** 版本標題，通常是 tag（可能再加上 release 名稱） */
  title: string;
  url: string;
  /** 從 release notes 掃出的標記：breaking / security / deprecation */
  tags: string[];
  published_at: string | null;
}

export interface WeeklySummaryResponse {
  period_start: string;
  period_end: string;
  total_repos: number;
  total_new_stars: number;
  /** 有幾個 repo 存在可比對的 7 天前快照。0 = total_new_stars 與 movers 都不具意義。
   *  標成 optional 是因為舊版 sidecar 不會回這個欄位（開發時前後端版本會錯開），
   *  消費端必須把「缺席」和 0 當同一件事處理。 */
  repos_compared?: number;
  top_gainers: WeeklyRepoSummary[];
  top_losers: WeeklyRepoSummary[];
  alerts_triggered: number;
  early_signals_detected: number;
  early_signals_by_type: Record<string, number>;
  hn_mentions: WeeklyHNMention[];
  releases: WeeklyRelease[];
  /** 版本抓取是否至少成功執行過一次。標成 optional 原因同 repos_compared——
   *  版本 skew 時舊 sidecar 不會回這個欄位，缺席要當成「還沒查」而不是「沒事」。 */
  releases_ever_fetched?: boolean;
  accelerating: number;
  decelerating: number;
}

// 對比模式型別

export interface ComparisonRepoData {
  repo_id: number;
  repo_name: string;
  color: string;
  data_points: ChartDataPoint[];
  current_stars: number;
  velocity: number | null;
  acceleration: number | null;
  trend: number | null;
  stars_delta_7d: number | null;
  stars_delta_30d: number | null;
  issues_delta_7d: number | null;
  issues_delta_30d: number | null;
}

export interface ComparisonChartResponse {
  repos: ComparisonRepoData[];
  time_range: string;
  /** 被略過的封存 repo id。存好的比較組合中有人取消追蹤時，後端回報而非整批 404 */
  skipped_archived: number[];
}

export type ComparisonTimeRange = "7d" | "30d" | "90d" | "all";

// Portfolio 歷史型別

export interface PortfolioHistoryPoint {
  date: string; // "YYYY-MM-DD"
  total_stars: number;
  repo_count: number;
}

export interface PortfolioHistoryResponse {
  history: PortfolioHistoryPoint[];
  total_points: number;
  days: number;
}

// Dashboard 時間範圍

export type DashboardTimeRange = 7 | 14 | 30;

// 應用程式設定型別

export interface FetchIntervalResponse {
  interval_minutes: number;
}

export interface SnapshotRetentionResponse {
  retention_days: number;
}

export interface SignalThresholdsResponse {
  rising_star_min_velocity: number;
  sudden_spike_multiplier: number;
  breakout_velocity_threshold: number;
  viral_hn_min_score: number;
}

export interface SignalThresholdsUpdate {
  rising_star_min_velocity?: number;
  sudden_spike_multiplier?: number;
  breakout_velocity_threshold?: number;
  viral_hn_min_score?: number;
}

export interface DiagnosticsResponse {
  version: string;
  db_path: string;
  db_size_mb: number;
  total_repos: number;
  total_snapshots: number;
  last_snapshot_at: string | null;
  uptime_seconds: number;
  last_fetch_success: string | null;
  last_fetch_failure: string | null;
  last_fetch_error: string | null;
  last_alert_check: string | null;
  last_backup: string | null;
  /**
   * 後端此刻是否正在跑全量抓取。UI 的「抓取中」要讀這個而不是自己的 promise——
   * 手動觸發撞到排程中的抓取時 POST 會立刻回 409，promise 結束了但抓取還在跑。
   */
  fetch_in_progress: boolean;
}

export interface ResetDataResponse {
  status: string;
  deleted_repos: number;
}

export interface TrendingTopic {
  topic: string;
  /** 最近 60 天新專案中有幾個標了這個 topic */
  sample_count: number;
  /** 全 GitHub 有幾個 repo 標了它 */
  global_count: number;
  /** 升溫比值：每十萬個 repo 中有幾個是這波新的。排序用，不是精確指標 */
  heat: number;
  already_added: boolean;
}

export interface TrendingProgress {
  running: boolean;
  /** "sampling"（取樣）或 "counting"（查熱度） */
  phase: string;
  done: number;
  total: number;
}

export interface TrendingResponse {
  topics: TrendingTopic[];
  /** null 代表從未計算過 */
  computed_at: string | null;
}

// --- For You Feed ---

export type InterestKind = "topic" | "language" | "keyword";

export interface Interest {
  id: number;
  term: string;
  kind: InterestKind;
  weight: number;
}

export interface InterestCreate {
  term: string;
  kind: InterestKind;
  weight: number;
}

export interface InterestListResponse {
  interests: Interest[];
}

export interface ExcludeTerm {
  id: number;
  term: string;
}

export interface ExclusionListResponse {
  exclusions: ExcludeTerm[];
}

export interface FeedReason {
  matched: string[];
  stars: number;
  age_days: number | null;
  /** repo 最後一次 push 的時間，用於判斷專案是否仍在維護 */
  pushed_at: string | null;
}

export type FeedFeedbackAction = "starred" | "dismissed";

export interface FeedItem {
  id: number;
  github_id: number;
  full_name: string;
  owner: string;
  name: string;
  description: string | null;
  language: string | null;
  topics: string[];
  stars: number;
  forks: number;
  url: string;
  owner_avatar_url: string | null;
  score: number;
  reason: FeedReason;
  feedback: FeedFeedbackAction | null;
}

export interface FeedResponse {
  feed_date: string;
  items: FeedItem[];
}

export interface GenerateFeedResult {
  feed_date: string;
  generated: number;
}

/** 近 N 天的 feed 成效。shown 是分母，其餘三個是分子。 */
export interface FeedStats {
  days: number;
  shown: number;
  opened: number;
  starred: number;
  dismissed: number;
}

/** 一次 star 同步的結果。skipped_reason 非 null 時，其餘計數皆為 0。 */
export interface SyncResult {
  added: number;
  restored: number;
  renamed: number;
  archived: number;
  /** "no_token" | "already_running" | "fetch_failed" | "empty_response" */
  skipped_reason: string | null;
  /** 首次同步時「本機有、GitHub 沒有」的 repo，交由使用者決定去留 */
  pending_local_only: string[];
}

export interface SyncStatus {
  last_sync_at: string | null;
  running: boolean;
}
