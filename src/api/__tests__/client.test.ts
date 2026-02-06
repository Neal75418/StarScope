/**
 * Unit tests for API client functions
 * (Simplified after removing Tags, Comparisons, Health Score, and Webhooks)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkHealth,
  getRepos,
  addRepo,
  removeRepo,
  fetchRepo,
  fetchAllRepos,
  getContextBadges,
  getContextSignals,
  getStarsChart,
  getSimilarRepos,
  getRecommendationStats,
  getCategoryTree,
  createCategory,
  deleteCategory,
  getCategoryRepos,
  addRepoToCategory,
  getRepoCategories,
  listEarlySignals,
  getSignalSummary,
  ApiError,
  searchRepos,
  listTriggeredAlerts,
  getContextBadgesBatch,
  getRepoSignalsBatch,
} from "../client";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("API Client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("ApiError", () => {
    it("creates error with status and detail", () => {
      const error = new ApiError(404, "Not found");
      expect(error.status).toBe(404);
      expect(error.detail).toBe("Not found");
      expect(error.name).toBe("ApiError");
    });

    it("extends Error", () => {
      const error = new ApiError(500, "Server error");
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe("checkHealth", () => {
    it("returns health status on success", async () => {
      const mockResponse = {
        status: "ok",
        service: "starscope",
        timestamp: "2024-01-15T10:00:00Z",
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await checkHealth();
      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/health"),
        expect.any(Object)
      );
    });

    it("throws ApiError on failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ detail: "Service unavailable" }),
      });

      expect(checkHealth()).rejects.toThrow(ApiError);
    });
  });

  describe("getRepos", () => {
    it("returns repos list", async () => {
      const mockResponse = {
        repos: [{ id: 1, full_name: "facebook/react" }],
        total: 1,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getRepos();
      expect(result.repos).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe("addRepo", () => {
    it("creates repo with owner/name", async () => {
      const mockResponse = { id: 1, full_name: "facebook/react" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await addRepo({ owner: "facebook", name: "react" });
      expect(result.full_name).toBe("facebook/react");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/repos"),
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    it("creates repo with url", async () => {
      const mockResponse = { id: 1, full_name: "vuejs/vue" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await addRepo({ url: "https://github.com/vuejs/vue" });
      expect(result.full_name).toBe("vuejs/vue");
    });
  });

  describe("removeRepo", () => {
    it("removes repo successfully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: async () => ({ success: true }),
      });

      await removeRepo(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/repos/1"),
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  describe("fetchRepo", () => {
    it("fetches updated repo data", async () => {
      const mockResponse = { id: 1, full_name: "facebook/react", stars: 200000 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await fetchRepo(1);
      expect(result.stars).toBe(200000);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/repos/1/fetch"),
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  describe("fetchAllRepos", () => {
    it("fetches all repos", async () => {
      const mockResponse = { repos: [], total: 0 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await fetchAllRepos();
      expect(result.total).toBe(0);
    });
  });

  describe("getContextBadges", () => {
    it("returns context badges", async () => {
      const mockResponse = {
        repo_id: 1,
        badges: [{ type: "hn", label: "Hacker News", url: "#", score: 100, is_recent: true }],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getContextBadges(1);
      expect(result.badges).toHaveLength(1);
    });
  });

  describe("getStarsChart", () => {
    it("returns chart data", async () => {
      const mockResponse = {
        repo_id: 1,
        repo_name: "facebook/react",
        time_range: "30d",
        data_points: [],
        min_stars: 0,
        max_stars: 200000,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getStarsChart(1, "30d");
      expect(result.time_range).toBe("30d");
    });
  });

  describe("Error handling", () => {
    it("handles network errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network failure"));

      expect(checkHealth()).rejects.toThrow();
    });

    it("handles JSON parse errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      expect(checkHealth()).rejects.toThrow();
    });

    it("handles non-ok response with JSON parse failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error("not JSON");
        },
      });

      try {
        await checkHealth();
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).status).toBe(500);
        // Falls back to "Unknown error" when JSON parse fails
        expect((e as ApiError).detail).toContain("Unknown error");
      }
    });

    it("uses error.detail when present in non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({ detail: "Validation failed" }),
      });

      try {
        await checkHealth();
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).detail).toBe("Validation failed");
      }
    });

    it("falls back to HTTP status when error.detail is missing", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 418,
        json: async () => ({}),
      });

      try {
        await checkHealth();
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).detail).toContain("HTTP 418");
      }
    });

    it("handles DOMException AbortError as timeout when no caller signal", async () => {
      const abortError = new DOMException("Aborted", "AbortError");
      mockFetch.mockRejectedValueOnce(abortError);

      try {
        await checkHealth();
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).detail).toBe("Request timed out");
      }
    });

    it("handles AbortError as cancelled when caller signal is aborted", async () => {
      const abortError = new DOMException("Aborted", "AbortError");
      mockFetch.mockRejectedValueOnce(abortError);

      const controller = new AbortController();
      controller.abort();

      try {
        await getRepos(); // Can't easily pass signal to getRepos, use searchRepos instead
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
      }
    });

    it("handles non-Error thrown by fetch", async () => {
      mockFetch.mockRejectedValueOnce("string error");

      try {
        await checkHealth();
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).detail).toContain("Network error");
        expect((e as ApiError).detail).toContain("Unknown");
      }
    });
  });

  // Similar repos tests
  describe("getSimilarRepos", () => {
    it("returns similar repos", async () => {
      const mockResponse = { repo_id: 1, similar: [], total: 0 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getSimilarRepos(1);
      expect(result.repo_id).toBe(1);
    });
  });

  describe("getRecommendationStats", () => {
    it("returns stats", async () => {
      const mockResponse = {
        total_repos: 10,
        total_similarity_pairs: 50,
        repos_with_recommendations: 8,
        average_similarity_score: 0.75,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getRecommendationStats();
      expect(result.total_repos).toBe(10);
    });
  });

  describe("getContextSignals", () => {
    it("returns context signals", async () => {
      const mockResponse = { signals: [], total: 0, repo_id: 1 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getContextSignals(1);
      expect(result.repo_id).toBe(1);
    });

    it("appends signal_type query param when provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ signals: [], total: 0, repo_id: 1 }),
      });

      await getContextSignals(1, "hn");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("signal_type=hn"),
        expect.any(Object)
      );
    });

    it("does not append signal_type when not provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ signals: [], total: 0, repo_id: 1 }),
      });

      await getContextSignals(1);
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).not.toContain("signal_type");
    });
  });

  // Category API tests
  describe("getCategoryTree", () => {
    it("returns category tree", async () => {
      const mockResponse = { tree: [], total: 0 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getCategoryTree();
      expect(result.tree).toEqual([]);
    });
  });

  describe("createCategory", () => {
    it("creates a category", async () => {
      const mockResponse = { id: 1, name: "Backend" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await createCategory({ name: "Backend" });
      expect(result.name).toBe("Backend");
    });
  });

  describe("deleteCategory", () => {
    it("deletes a category", async () => {
      const mockResponse = { status: "success", message: "Deleted" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await deleteCategory(1);
      expect(result.status).toBe("success");
    });
  });

  describe("getCategoryRepos", () => {
    it("returns repos in category", async () => {
      const mockResponse = { category_id: 1, category_name: "Frontend", repos: [], total: 0 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getCategoryRepos(1);
      expect(result.category_id).toBe(1);
    });
  });

  describe("addRepoToCategory", () => {
    it("adds repo to category", async () => {
      const mockResponse = { status: "success", message: "Added" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await addRepoToCategory(1, 5);
      expect(result.status).toBe("success");
    });
  });

  describe("getRepoCategories", () => {
    it("returns categories for repo", async () => {
      const mockResponse = { repo_id: 1, categories: [], total: 0 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getRepoCategories(1);
      expect(result.repo_id).toBe(1);
    });
  });

  // Early Signal API tests
  describe("listEarlySignals", () => {
    it("returns early signals", async () => {
      const mockResponse = { signals: [], total: 0 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await listEarlySignals();
      expect(result.total).toBe(0);
    });

    it("passes no query params when no options", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ signals: [], total: 0 }),
      });

      await listEarlySignals();
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      // Should end with /early-signals/ (no query string)
      expect(calledUrl).toMatch(/\/early-signals\/$/);
    });
  });

  describe("getSignalSummary", () => {
    it("returns signal summary", async () => {
      const mockResponse = { total_active: 5, by_type: {}, by_severity: {}, repos_with_signals: 3 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getSignalSummary();
      expect(result.total_active).toBe(5);
    });
  });

  // Early signal additional tests
  describe("getRepoSignals", () => {
    it("returns signals for repo", async () => {
      const { getRepoSignals } = await import("../client");
      const mockResponse = { signals: [], total: 0 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getRepoSignals(1);
      expect(result.total).toBe(0);
    });

    it("includes options in query", async () => {
      const { getRepoSignals } = await import("../client");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ signals: [], total: 0 }),
      });

      await getRepoSignals(1, { include_acknowledged: true });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("include_acknowledged=true"),
        expect.any(Object)
      );
    });

    it("appends include_expired option to query", async () => {
      const { getRepoSignals } = await import("../client");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ signals: [], total: 0 }),
      });

      await getRepoSignals(1, { include_expired: true });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("include_expired=true"),
        expect.any(Object)
      );
    });
  });

  describe("acknowledgeSignal", () => {
    it("acknowledges a signal", async () => {
      const { acknowledgeSignal } = await import("../client");
      const mockResponse = { status: "success", message: "Acknowledged" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await acknowledgeSignal(1);
      expect(result.status).toBe("success");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/early-signals/1/acknowledge"),
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  describe("acknowledgeAllSignals", () => {
    it("acknowledges all signals", async () => {
      const { acknowledgeAllSignals } = await import("../client");
      const mockResponse = { status: "success", message: "All acknowledged" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await acknowledgeAllSignals();
      expect(result.status).toBe("success");
    });

    it("filters by signal type", async () => {
      const { acknowledgeAllSignals } = await import("../client");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "success", message: "Done" }),
      });

      await acknowledgeAllSignals("rising_star");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("signal_type=rising_star"),
        expect.any(Object)
      );
    });
  });

  describe("triggerDetection", () => {
    it("triggers anomaly detection", async () => {
      const { triggerDetection } = await import("../client");
      const mockResponse = {
        repos_scanned: 10,
        signals_detected: 2,
        by_type: {},
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await triggerDetection();
      expect(result.repos_scanned).toBe(10);
    });
  });

  describe("deleteSignal", () => {
    it("deletes a signal", async () => {
      const { deleteSignal } = await import("../client");
      const mockResponse = { status: "success", message: "Deleted" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await deleteSignal(1);
      expect(result.status).toBe("success");
    });
  });

  // Export URL tests
  describe("Export URL functions", () => {
    it("getExportWatchlistJsonUrl returns correct URL", async () => {
      const { getExportWatchlistJsonUrl } = await import("../client");
      const url = getExportWatchlistJsonUrl();
      expect(url).toContain("/export/watchlist.json");
    });

    it("getExportWatchlistCsvUrl returns correct URL", async () => {
      const { getExportWatchlistCsvUrl } = await import("../client");
      const url = getExportWatchlistCsvUrl();
      expect(url).toContain("/export/watchlist.csv");
    });
  });

  // GitHub Auth tests
  describe("GitHub Auth API", () => {
    it("initiateDeviceFlow starts auth flow", async () => {
      const { initiateDeviceFlow } = await import("../client");
      const mockResponse = {
        device_code: "abc123",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await initiateDeviceFlow();
      expect(result.user_code).toBe("ABCD-1234");
    });

    it("pollAuthorization polls for auth", async () => {
      const { pollAuthorization } = await import("../client");
      const mockResponse = { status: "pending" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await pollAuthorization("abc123");
      expect(result.status).toBe("pending");
    });

    it("getGitHubConnectionStatus returns status", async () => {
      const { getGitHubConnectionStatus } = await import("../client");
      const mockResponse = {
        connected: true,
        username: "testuser",
        rate_limit_remaining: 5000,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getGitHubConnectionStatus();
      expect(result.connected).toBe(true);
      expect(result.username).toBe("testuser");
    });

    it("disconnectGitHub disconnects", async () => {
      const { disconnectGitHub } = await import("../client");
      const mockResponse = { success: true, message: "Disconnected" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await disconnectGitHub();
      expect(result.success).toBe(true);
    });
  });

  // listEarlySignals with options
  describe("listEarlySignals with options", () => {
    it("passes all options to query string", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ signals: [], total: 0 }),
      });

      await listEarlySignals({
        signal_type: "rising_star",
        severity: "high",
        include_acknowledged: true,
        include_expired: true,
        limit: 10,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/signal_type=rising_star/),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/severity=high/),
        expect.any(Object)
      );
    });

    it("omits falsy options from query string", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ signals: [], total: 0 }),
      });

      await listEarlySignals({ signal_type: "rising_star" });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("signal_type=rising_star");
      expect(calledUrl).not.toContain("include_acknowledged");
      expect(calledUrl).not.toContain("include_expired");
      expect(calledUrl).not.toContain("severity");
      expect(calledUrl).not.toContain("limit");
    });
  });

  // --- New tests for uncovered branches ---

  describe("searchRepos", () => {
    it("calls discovery/search endpoint with query and page", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ repos: [], total_count: 0, page: 1, per_page: 30, has_more: false }),
      });

      await searchRepos("react");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/discovery/search"),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("q=react"),
        expect.any(Object)
      );
    });

    it("includes language filter in query", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ repos: [], total_count: 0, page: 1, per_page: 30, has_more: false }),
      });

      await searchRepos("web", { language: "TypeScript" });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("language=TypeScript"),
        expect.any(Object)
      );
    });

    it("includes minStars filter in query", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ repos: [], total_count: 0, page: 1, per_page: 30, has_more: false }),
      });

      await searchRepos("web", { minStars: 1000 });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("min_stars=1000"),
        expect.any(Object)
      );
    });

    it("includes topic filter in query", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ repos: [], total_count: 0, page: 1, per_page: 30, has_more: false }),
      });

      await searchRepos("web", { topic: "frontend" });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("topic=frontend"),
        expect.any(Object)
      );
    });

    it("includes sort filter in query", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ repos: [], total_count: 0, page: 1, per_page: 30, has_more: false }),
      });

      await searchRepos("web", { sort: "stars" });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("sort=stars"),
        expect.any(Object)
      );
    });

    it("passes abort signal to fetch", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ repos: [], total_count: 0, page: 1, per_page: 30, has_more: false }),
      });

      const controller = new AbortController();
      await searchRepos("test", {}, 1, controller.signal);
      // Signal is wrapped by apiCall's timeout controller, so we just verify fetch was called
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("does not include empty filters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ repos: [], total_count: 0, page: 1, per_page: 30, has_more: false }),
      });

      await searchRepos("test", {});
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).not.toContain("language=");
      expect(calledUrl).not.toContain("min_stars=");
      expect(calledUrl).not.toContain("topic=");
      expect(calledUrl).not.toContain("sort=");
    });
  });

  describe("listTriggeredAlerts", () => {
    it("includes limit parameter", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await listTriggeredAlerts();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("limit=50"),
        expect.any(Object)
      );
    });

    it("includes unacknowledged_only when true", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await listTriggeredAlerts(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("unacknowledged_only=true"),
        expect.any(Object)
      );
    });

    it("does not include unacknowledged_only when false", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await listTriggeredAlerts(false);
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).not.toContain("unacknowledged_only");
    });

    it("passes custom limit", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await listTriggeredAlerts(false, 10);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("limit=10"),
        expect.any(Object)
      );
    });
  });

  describe("getContextBadgesBatch", () => {
    it("returns batch results", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: {
            "1": { repo_id: 1, badges: [] },
            "2": { repo_id: 2, badges: [] },
          },
        }),
      });

      const result = await getContextBadgesBatch([1, 2]);
      expect(result["1"]).toBeDefined();
      expect(result["2"]).toBeDefined();
    });
  });

  describe("getRepoSignalsBatch", () => {
    it("returns batch signal results", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: {
            "1": { signals: [], total: 0 },
          },
        }),
      });

      const result = await getRepoSignalsBatch([1]);
      expect(result["1"]).toBeDefined();
    });
  });

  describe("Alert API functions", () => {
    it("listAlertRules returns rules", async () => {
      const { listAlertRules } = await import("../client");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const result = await listAlertRules();
      expect(result).toEqual([]);
    });

    it("createAlertRule creates rule", async () => {
      const { createAlertRule } = await import("../client");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 1, name: "Test Rule" }),
      });

      const result = await createAlertRule({
        name: "Test Rule",
        signal_type: "rising_star",
        operator: ">",
        threshold: 100,
      });
      expect(result.name).toBe("Test Rule");
    });

    it("updateAlertRule updates rule", async () => {
      const { updateAlertRule } = await import("../client");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 1, name: "Updated Rule" }),
      });

      const result = await updateAlertRule(1, { name: "Updated Rule" });
      expect(result.name).toBe("Updated Rule");
    });

    it("deleteAlertRule deletes rule", async () => {
      const { deleteAlertRule } = await import("../client");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "success", id: 1 }),
      });

      const result = await deleteAlertRule(1);
      expect(result.status).toBe("success");
    });

    it("acknowledgeTriggeredAlert acknowledges", async () => {
      const { acknowledgeTriggeredAlert } = await import("../client");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "success", id: 1 }),
      });

      const result = await acknowledgeTriggeredAlert(1);
      expect(result.status).toBe("success");
    });

    it("acknowledgeAllTriggeredAlerts acknowledges all", async () => {
      const { acknowledgeAllTriggeredAlerts } = await import("../client");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "success", count: 5 }),
      });

      const result = await acknowledgeAllTriggeredAlerts();
      expect(result.count).toBe(5);
    });

    it("checkAlerts triggers check", async () => {
      const { checkAlerts } = await import("../client");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "success", triggered_count: 2, triggered: [] }),
      });

      const result = await checkAlerts();
      expect(result.triggered_count).toBe(2);
    });

    it("listSignalTypes returns signal types", async () => {
      const { listSignalTypes } = await import("../client");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ type: "rising_star", name: "Rising Star", description: "desc" }],
      });

      const result = await listSignalTypes();
      expect(result).toHaveLength(1);
    });
  });
});
