/**
 * API client for communicating with the Python sidecar.
 */

const API_BASE = "http://127.0.0.1:8008/api";

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
  const url = `${API_BASE}${endpoint}`;

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
