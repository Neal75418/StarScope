/**
 * API 型別定義。
 * 所有與 Python sidecar 通訊的介面型別集中在此。
 */

// ==================== 基礎型別 ====================

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

// ==================== Context Signal 型別 ====================

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

// ==================== Commit 活動型別 ====================

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

// ==================== 語言統計型別 ====================

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

// ==================== 星數歷史回填型別 ====================

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

// ==================== 圖表型別 ====================

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

// ==================== API 錯誤類別 ====================

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

// ==================== 推薦系統型別 ====================

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

// ==================== 分類型別 ====================

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

// ==================== 早期信號型別 ====================

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

// ==================== 趨勢型別 ====================

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
  rank: number;
}

export interface TrendsResponse {
  repos: TrendingRepo[];
  total: number;
  sort_by: string;
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
