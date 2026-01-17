/**
 * API client for communicating with the Python sidecar.
 */

import { API_ENDPOINT } from "../config";

// Types
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
  trend: number | null; // -1, 0, 1
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

// Context Signal types
export interface ContextBadge {
  type: "hn" | "reddit" | "release";
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

// Health Score types
export interface HealthMetrics {
  avg_issue_response_hours: number | null;
  pr_merge_rate: number | null;
  days_since_last_release: number | null;
  contributor_count: number | null;
  has_readme: boolean | null;
  has_contributing: boolean | null;
  has_license: boolean | null;
}

export interface HealthScoreResponse {
  repo_id: number;
  repo_name: string;
  overall_score: number;
  grade: string;
  issue_response_score: number | null;
  pr_merge_score: number | null;
  release_cadence_score: number | null;
  bus_factor_score: number | null;
  documentation_score: number | null;
  dependency_score: number | null;
  velocity_score: number | null;
  metrics: HealthMetrics | null;
  calculated_at: string;
}

export interface HealthScoreSummary {
  repo_id: number;
  overall_score: number;
  grade: string;
  calculated_at: string;
}

// Chart types
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

// API Error class
export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

// Helper function for API calls
async function apiCall<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_ENDPOINT}${endpoint}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Unknown error" }));
      throw new ApiError(response.status, error.detail || `HTTP ${response.status}`);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return null as T;
    }

    return response.json();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(0, `Network error: ${error instanceof Error ? error.message : "Unknown"}`);
  }
}

// API functions

/**
 * Check if the sidecar is running.
 */
export async function checkHealth(): Promise<HealthResponse> {
  return apiCall<HealthResponse>("/health");
}

/**
 * Get all repositories in the watchlist.
 */
export async function getRepos(): Promise<RepoListResponse> {
  return apiCall<RepoListResponse>("/repos");
}

/**
 * Add a new repository to the watchlist.
 */
export async function addRepo(input: RepoCreate): Promise<RepoWithSignals> {
  return apiCall<RepoWithSignals>("/repos", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * Get a single repository by ID.
 */
export async function getRepo(repoId: number): Promise<RepoWithSignals> {
  return apiCall<RepoWithSignals>(`/repos/${repoId}`);
}

/**
 * Remove a repository from the watchlist.
 */
export async function removeRepo(repoId: number): Promise<void> {
  return apiCall<void>(`/repos/${repoId}`, {
    method: "DELETE",
  });
}

/**
 * Fetch the latest data for a repository.
 */
export async function fetchRepo(repoId: number): Promise<RepoWithSignals> {
  return apiCall<RepoWithSignals>(`/repos/${repoId}/fetch`, {
    method: "POST",
  });
}

/**
 * Fetch the latest data for all repositories.
 */
export async function fetchAllRepos(): Promise<RepoListResponse> {
  return apiCall<RepoListResponse>("/repos/fetch-all", {
    method: "POST",
  });
}

// Context Signal API functions

/**
 * Get context badges for a repository.
 */
export async function getContextBadges(repoId: number): Promise<ContextBadgesResponse> {
  return apiCall<ContextBadgesResponse>(`/context/${repoId}/badges`);
}

/**
 * Get all context signals for a repository.
 */
export async function getContextSignals(
  repoId: number,
  signalType?: string
): Promise<ContextSignalsResponse> {
  const params = signalType ? `?signal_type=${signalType}` : "";
  return apiCall<ContextSignalsResponse>(`/context/${repoId}/signals${params}`);
}

/**
 * Manually trigger context signal fetch for a repository.
 */
export async function fetchRepoContext(repoId: number): Promise<{ repo_id: number; new_signals: Record<string, number> }> {
  return apiCall(`/context/${repoId}/fetch`, {
    method: "POST",
  });
}

// Chart API functions

/**
 * Get star history chart data for a repository.
 */
export async function getStarsChart(
  repoId: number,
  timeRange: "7d" | "30d" | "90d" = "30d"
): Promise<StarsChartResponse> {
  return apiCall<StarsChartResponse>(`/charts/${repoId}/stars?time_range=${timeRange}`);
}

// Health Score API functions

/**
 * Get health score for a repository.
 */
export async function getHealthScore(repoId: number): Promise<HealthScoreResponse> {
  return apiCall<HealthScoreResponse>(`/health-score/${repoId}`);
}

/**
 * Get health score summary (for badges).
 */
export async function getHealthScoreSummary(repoId: number): Promise<HealthScoreSummary> {
  return apiCall<HealthScoreSummary>(`/health-score/${repoId}/summary`);
}

/**
 * Calculate (or recalculate) health score for a repository.
 */
export async function calculateHealthScore(repoId: number): Promise<HealthScoreResponse> {
  return apiCall<HealthScoreResponse>(`/health-score/${repoId}/calculate`, {
    method: "POST",
  });
}

// Tag types

export type TagType = "language" | "topic" | "inferred" | "custom";

export interface Tag {
  id: number;
  name: string;
  type: TagType;
  color: string | null;
  created_at: string;
}

export interface RepoTag {
  id: number;
  name: string;
  type: TagType;
  color: string | null;
  source: "auto" | "user";
  confidence: number | null;
  applied_at: string | null;
}

export interface TagListResponse {
  tags: Tag[];
  total: number;
}

export interface RepoTagsResponse {
  repo_id: number;
  tags: RepoTag[];
  total: number;
}

export interface AutoTagResponse {
  repo_id: number;
  tags_applied: { name: string; type: string; source: string }[];
  total_applied: number;
}

export interface AutoTagAllResponse {
  total_repos: number;
  repos_tagged: number;
  tags_applied: number;
}

export interface SearchByTagsResponse {
  repos: {
    id: number;
    full_name: string;
    description: string | null;
    language: string | null;
    tags: { name: string; type: string }[];
  }[];
  total: number;
}

// Tag API functions

/**
 * List all tags in the system.
 */
export async function listTags(tagType?: TagType): Promise<TagListResponse> {
  const params = tagType ? `?tag_type=${tagType}` : "";
  return apiCall<TagListResponse>(`/tags${params}`);
}

/**
 * Get all tags for a repository.
 */
export async function getRepoTags(repoId: number): Promise<RepoTagsResponse> {
  return apiCall<RepoTagsResponse>(`/tags/repo/${repoId}`);
}

/**
 * Add a custom tag to a repository.
 */
export async function addTagToRepo(
  repoId: number,
  name: string,
  color?: string
): Promise<RepoTagsResponse> {
  return apiCall<RepoTagsResponse>(`/tags/repo/${repoId}`, {
    method: "POST",
    body: JSON.stringify({ name, color }),
  });
}

/**
 * Remove a tag from a repository.
 */
export async function removeTagFromRepo(
  repoId: number,
  tagId: number
): Promise<{ status: string; message: string }> {
  return apiCall(`/tags/repo/${repoId}/${tagId}`, {
    method: "DELETE",
  });
}

/**
 * Trigger auto-tagging for a repository.
 */
export async function autoTagRepo(repoId: number): Promise<AutoTagResponse> {
  return apiCall<AutoTagResponse>(`/tags/repo/${repoId}/auto-tag`, {
    method: "POST",
  });
}

/**
 * Trigger auto-tagging for all repositories.
 */
export async function autoTagAllRepos(): Promise<AutoTagAllResponse> {
  return apiCall<AutoTagAllResponse>(`/tags/auto-tag-all`, {
    method: "POST",
  });
}

/**
 * Search repositories by tags.
 */
export async function searchByTags(
  tags: string[],
  matchAll: boolean = false
): Promise<SearchByTagsResponse> {
  const tagsParam = encodeURIComponent(tags.join(","));
  return apiCall<SearchByTagsResponse>(
    `/tags/search?tags=${tagsParam}&match_all=${matchAll}`
  );
}

// Recommendation types

export interface SimilarRepo {
  repo_id: number;
  full_name: string;
  description: string | null;
  language: string | null;
  url: string;
  similarity_score: number;
  shared_topics: string[];
  same_language: boolean;
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

// Recommendation API functions

/**
 * Get similar repositories for a given repo.
 */
export async function getSimilarRepos(
  repoId: number,
  limit: number = 10
): Promise<SimilarReposResponse> {
  return apiCall<SimilarReposResponse>(
    `/recommendations/similar/${repoId}?limit=${limit}`
  );
}

/**
 * Calculate similarities for a specific repository.
 */
export async function calculateRepoSimilarities(
  repoId: number
): Promise<CalculateSimilaritiesResponse> {
  return apiCall<CalculateSimilaritiesResponse>(
    `/recommendations/repo/${repoId}/calculate`,
    { method: "POST" }
  );
}

/**
 * Recalculate similarities for all repositories.
 */
export async function recalculateAllSimilarities(): Promise<RecalculateAllResponse> {
  return apiCall<RecalculateAllResponse>(`/recommendations/recalculate`, {
    method: "POST",
  });
}

/**
 * Get recommendation system statistics.
 */
export async function getRecommendationStats(): Promise<RecommendationStats> {
  return apiCall<RecommendationStats>(`/recommendations/stats`);
}

// Category types

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

export interface CategoryListResponse {
  categories: Category[];
  total: number;
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

// Category API functions

/**
 * List all categories (flat list).
 */
export async function listCategories(): Promise<CategoryListResponse> {
  return apiCall<CategoryListResponse>(`/categories`);
}

/**
 * Get categories as a tree structure.
 */
export async function getCategoryTree(): Promise<CategoryTreeResponse> {
  return apiCall<CategoryTreeResponse>(`/categories/tree`);
}

/**
 * Get a specific category.
 */
export async function getCategory(categoryId: number): Promise<Category> {
  return apiCall<Category>(`/categories/${categoryId}`);
}

/**
 * Create a new category.
 */
export async function createCategory(data: CategoryCreate): Promise<Category> {
  return apiCall<Category>(`/categories`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Update a category.
 */
export async function updateCategory(
  categoryId: number,
  data: CategoryUpdate
): Promise<Category> {
  return apiCall<Category>(`/categories/${categoryId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

/**
 * Delete a category.
 */
export async function deleteCategory(
  categoryId: number
): Promise<{ status: string; message: string }> {
  return apiCall(`/categories/${categoryId}`, {
    method: "DELETE",
  });
}

/**
 * Get repos in a category.
 */
export async function getCategoryRepos(
  categoryId: number
): Promise<CategoryReposResponse> {
  return apiCall<CategoryReposResponse>(`/categories/${categoryId}/repos`);
}

/**
 * Add a repo to a category.
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
 * Remove a repo from a category.
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
 * Get categories for a repo.
 */
export async function getRepoCategories(
  repoId: number
): Promise<RepoCategoriesResponse> {
  return apiCall<RepoCategoriesResponse>(`/categories/repo/${repoId}/categories`);
}

// Comparison types

export interface ComparisonGroup {
  id: number;
  name: string;
  description: string | null;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface ComparisonMember {
  repo_id: number;
  full_name: string;
  language: string | null;
  description: string | null;
  url: string;
  stars: number | null;
  forks: number | null;
  stars_delta_7d: number | null;
  stars_delta_30d: number | null;
  velocity: number | null;
  acceleration: number | null;
  trend: number | null;
  health_score: number | null;
  health_grade: string | null;
}

export interface ComparisonSummary {
  total_members: number;
  leader_by_stars: string | null;
  leader_by_velocity: string | null;
  leader_by_health: string | null;
  total_stars: number;
  avg_velocity: number;
  avg_health: number;
}

export interface ComparisonGroupDetail {
  group_id: number;
  group_name: string;
  description: string | null;
  members: ComparisonMember[];
  summary: ComparisonSummary;
}

export interface ComparisonGroupListResponse {
  groups: ComparisonGroup[];
  total: number;
}

export interface ComparisonChartSeries {
  repo_id: number;
  full_name: string;
  language: string | null;
  data: (number | null)[];
}

export interface ComparisonChartData {
  group_id: number;
  group_name: string;
  time_range: string;
  dates: string[];
  series: ComparisonChartSeries[];
}

export interface VelocityComparisonItem {
  repo_id: number;
  full_name: string;
  velocity: number;
  delta_7d: number;
  delta_30d: number;
}

export interface VelocityComparisonData {
  group_id: number;
  group_name: string;
  data: VelocityComparisonItem[];
}

// Comparison API functions

/**
 * List all comparison groups.
 */
export async function listComparisonGroups(): Promise<ComparisonGroupListResponse> {
  return apiCall<ComparisonGroupListResponse>(`/comparisons`);
}

/**
 * Get a comparison group with full data.
 */
export async function getComparisonGroup(
  groupId: number
): Promise<ComparisonGroupDetail> {
  return apiCall<ComparisonGroupDetail>(`/comparisons/${groupId}`);
}

/**
 * Create a new comparison group.
 */
export async function createComparisonGroup(
  name: string,
  description?: string
): Promise<ComparisonGroup> {
  return apiCall<ComparisonGroup>(`/comparisons`, {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });
}

/**
 * Update a comparison group.
 */
export async function updateComparisonGroup(
  groupId: number,
  data: { name?: string; description?: string }
): Promise<ComparisonGroup> {
  return apiCall<ComparisonGroup>(`/comparisons/${groupId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

/**
 * Delete a comparison group.
 */
export async function deleteComparisonGroup(
  groupId: number
): Promise<{ status: string; message: string }> {
  return apiCall(`/comparisons/${groupId}`, {
    method: "DELETE",
  });
}

/**
 * Add a repo to a comparison group.
 */
export async function addRepoToComparison(
  groupId: number,
  repoId: number
): Promise<{ status: string; message: string }> {
  return apiCall(`/comparisons/${groupId}/repos/${repoId}`, {
    method: "POST",
  });
}

/**
 * Remove a repo from a comparison group.
 */
export async function removeRepoFromComparison(
  groupId: number,
  repoId: number
): Promise<{ status: string; message: string }> {
  return apiCall(`/comparisons/${groupId}/repos/${repoId}`, {
    method: "DELETE",
  });
}

/**
 * Get chart data for a comparison group.
 */
export async function getComparisonChart(
  groupId: number,
  timeRange: "7d" | "30d" | "90d" = "30d"
): Promise<ComparisonChartData> {
  return apiCall<ComparisonChartData>(
    `/comparisons/${groupId}/chart?time_range=${timeRange}`
  );
}

/**
 * Get velocity comparison data.
 */
export async function getVelocityComparison(
  groupId: number
): Promise<VelocityComparisonData> {
  return apiCall<VelocityComparisonData>(`/comparisons/${groupId}/velocity`);
}

// Early Signal types

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

// Early Signal API functions

/**
 * List all early signals.
 */
export async function listEarlySignals(
  options?: {
    signal_type?: EarlySignalType;
    severity?: EarlySignalSeverity;
    include_acknowledged?: boolean;
    include_expired?: boolean;
    limit?: number;
  }
): Promise<EarlySignalListResponse> {
  const params = new URLSearchParams();
  if (options?.signal_type) params.append("signal_type", options.signal_type);
  if (options?.severity) params.append("severity", options.severity);
  if (options?.include_acknowledged) params.append("include_acknowledged", "true");
  if (options?.include_expired) params.append("include_expired", "true");
  if (options?.limit) params.append("limit", String(options.limit));

  const queryString = params.toString();
  return apiCall<EarlySignalListResponse>(
    `/early-signals${queryString ? `?${queryString}` : ""}`
  );
}

/**
 * Get early signals for a specific repository.
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
 * Get signal summary statistics.
 */
export async function getSignalSummary(): Promise<SignalSummary> {
  return apiCall<SignalSummary>(`/early-signals/summary`);
}

/**
 * Acknowledge a signal.
 */
export async function acknowledgeSignal(
  signalId: number
): Promise<{ status: string; message: string }> {
  return apiCall(`/early-signals/${signalId}/acknowledge`, {
    method: "POST",
  });
}

/**
 * Acknowledge all signals.
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
 * Trigger anomaly detection.
 */
export async function triggerDetection(): Promise<DetectionResult> {
  return apiCall<DetectionResult>(`/early-signals/detect`, {
    method: "POST",
  });
}

/**
 * Delete an early signal.
 */
export async function deleteSignal(
  signalId: number
): Promise<{ status: string; message: string }> {
  return apiCall(`/early-signals/${signalId}`, {
    method: "DELETE",
  });
}

// ==================== Export API ====================

/**
 * Get export download URL for watchlist.
 */
export function getExportWatchlistUrl(format: "json" | "csv"): string {
  return `${API_ENDPOINT}/export/watchlist.${format}`;
}

/**
 * Get export download URL for repo history.
 */
export function getExportHistoryUrl(repoId: number, format: "json" | "csv", days?: number): string {
  const params = days ? `?days=${days}` : "";
  return `${API_ENDPOINT}/export/history/${repoId}.${format}${params}`;
}

/**
 * Get export download URL for signals.
 */
export function getExportSignalsUrl(format: "json" | "csv", includeAcknowledged?: boolean): string {
  const params = includeAcknowledged ? "?include_acknowledged=true" : "";
  return `${API_ENDPOINT}/export/${format === "json" ? "signals.json" : "signals.csv"}${params}`;
}

/**
 * Get export download URL for full report.
 */
export function getExportFullReportUrl(): string {
  return `${API_ENDPOINT}/export/full-report.json`;
}

/**
 * Get digest URL.
 */
export function getDigestUrl(period: "daily" | "weekly", format: "json" | "md" | "html"): string {
  return `${API_ENDPOINT}/export/digest/${period}.${format}`;
}

// ==================== Webhook Types ====================

export type WebhookType = "slack" | "discord" | "generic";
export type WebhookTrigger = "signal_detected" | "daily_digest" | "weekly_digest" | "threshold_alert";

export interface Webhook {
  id: number;
  name: string;
  webhook_type: WebhookType;
  url: string;
  triggers: WebhookTrigger[];
  min_severity: string | null;
  enabled: boolean;
  last_triggered: string | null;
  last_error: string | null;
  created_at: string;
}

export interface WebhookListResponse {
  webhooks: Webhook[];
  total: number;
}

export interface WebhookCreate {
  name: string;
  webhook_type: WebhookType;
  url: string;
  triggers: WebhookTrigger[];
  min_severity?: string;
}

export interface WebhookUpdate {
  name?: string;
  url?: string;
  triggers?: WebhookTrigger[];
  min_severity?: string;
  enabled?: boolean;
}

export interface WebhookLog {
  id: number;
  trigger_type: string;
  success: boolean;
  status_code: number | null;
  error_message: string | null;
  sent_at: string;
}

export interface WebhookLogsResponse {
  webhook_id: number;
  logs: WebhookLog[];
  total: number;
}

export interface WebhookTypesResponse {
  types: { id: string; name: string; description: string }[];
  triggers: { id: string; name: string; description: string }[];
  severities: { id: string; name: string }[];
}

// ==================== Webhook API Functions ====================

/**
 * List all webhooks.
 */
export async function listWebhooks(): Promise<WebhookListResponse> {
  return apiCall<WebhookListResponse>(`/webhooks`);
}

/**
 * Get a specific webhook.
 */
export async function getWebhook(webhookId: number): Promise<Webhook> {
  return apiCall<Webhook>(`/webhooks/${webhookId}`);
}

/**
 * Create a new webhook.
 */
export async function createWebhook(data: WebhookCreate): Promise<Webhook> {
  return apiCall<Webhook>(`/webhooks`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Update a webhook.
 */
export async function updateWebhook(
  webhookId: number,
  data: WebhookUpdate
): Promise<Webhook> {
  return apiCall<Webhook>(`/webhooks/${webhookId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

/**
 * Delete a webhook.
 */
export async function deleteWebhook(
  webhookId: number
): Promise<{ status: string; message: string }> {
  return apiCall(`/webhooks/${webhookId}`, {
    method: "DELETE",
  });
}

/**
 * Test a webhook.
 */
export async function testWebhook(
  webhookId: number
): Promise<{ status: string; message: string; success: boolean }> {
  return apiCall(`/webhooks/${webhookId}/test`, {
    method: "POST",
  });
}

/**
 * Toggle webhook enabled state.
 */
export async function toggleWebhook(
  webhookId: number
): Promise<{ status: string; enabled: boolean }> {
  return apiCall(`/webhooks/${webhookId}/toggle`, {
    method: "POST",
  });
}

/**
 * Get webhook logs.
 */
export async function getWebhookLogs(
  webhookId: number,
  limit?: number
): Promise<WebhookLogsResponse> {
  const params = limit ? `?limit=${limit}` : "";
  return apiCall<WebhookLogsResponse>(`/webhooks/${webhookId}/logs${params}`);
}

/**
 * Get available webhook types and triggers.
 */
export async function getWebhookTypes(): Promise<WebhookTypesResponse> {
  return apiCall<WebhookTypesResponse>(`/webhooks/types/list`);
}

// ==================== GitHub Auth Types ====================

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
  interval?: number; // New interval to use when slow_down is true
}

export interface GitHubConnectionStatus {
  connected: boolean;
  username?: string;
  rate_limit_remaining?: number;
  rate_limit_total?: number;
  error?: string;
}

export interface DisconnectResponse {
  success: boolean;
  message: string;
}

// ==================== GitHub Auth API Functions ====================

/**
 * Initiate GitHub Device Flow authentication.
 * Returns device code and user code for the user to enter on GitHub.
 */
export async function initiateDeviceFlow(): Promise<DeviceCodeResponse> {
  return apiCall<DeviceCodeResponse>(`/github-auth/device-code`, {
    method: "POST",
  });
}

/**
 * Poll for authorization status during Device Flow.
 * Call this periodically until status is "success" or "error"/"expired".
 */
export async function pollAuthorization(deviceCode: string): Promise<PollResponse> {
  return apiCall<PollResponse>(`/github-auth/poll`, {
    method: "POST",
    body: JSON.stringify({ device_code: deviceCode }),
  });
}

/**
 * Get the current GitHub connection status.
 */
export async function getGitHubConnectionStatus(): Promise<GitHubConnectionStatus> {
  return apiCall<GitHubConnectionStatus>(`/github-auth/status`);
}

/**
 * Disconnect from GitHub by removing stored credentials.
 */
export async function disconnectGitHub(): Promise<DisconnectResponse> {
  return apiCall<DisconnectResponse>(`/github-auth/disconnect`, {
    method: "POST",
  });
}
