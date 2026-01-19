/**
 * Unit tests for API client functions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkHealth,
  getRepos,
  addRepo,
  getRepo,
  removeRepo,
  fetchRepo,
  fetchAllRepos,
  getContextBadges,
  getContextSignals,
  getHealthScoreSummary,
  getHealthScore,
  calculateHealthScore,
  getStarsChart,
  listTags,
  getRepoTags,
  addTagToRepo,
  removeTagFromRepo,
  autoTagRepo,
  searchByTags,
  getSimilarRepos,
  getRecommendationStats,
  listCategories,
  getCategoryTree,
  createCategory,
  deleteCategory,
  getCategoryRepos,
  addRepoToCategory,
  getRepoCategories,
  listComparisonGroups,
  getComparisonGroup,
  createComparisonGroup,
  listEarlySignals,
  getSignalSummary,
  ApiError,
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

      await expect(checkHealth()).rejects.toThrow(ApiError);
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

  describe("getRepo", () => {
    it("returns single repo by id", async () => {
      const mockResponse = { id: 1, full_name: "facebook/react" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getRepo(1);
      expect(result.id).toBe(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/repos/1"),
        expect.any(Object)
      );
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

  describe("getHealthScoreSummary", () => {
    it("returns health score summary", async () => {
      const mockResponse = {
        repo_id: 1,
        overall_score: 85,
        grade: "A",
        calculated_at: "2024-01-15",
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getHealthScoreSummary(1);
      expect(result).not.toBeNull();
      if (result) {
        expect(result.grade).toBe("A");
      }
    });
  });

  describe("calculateHealthScore", () => {
    it("calculates and returns health score", async () => {
      const mockResponse = {
        repo_id: 1,
        overall_score: 90,
        grade: "A",
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await calculateHealthScore(1);
      expect(result.overall_score).toBe(90);
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

      await expect(checkHealth()).rejects.toThrow();
    });

    it("handles JSON parse errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      await expect(checkHealth()).rejects.toThrow();
    });
  });

  // Tag API tests
  describe("listTags", () => {
    it("returns all tags", async () => {
      const mockResponse = { tags: [{ id: 1, name: "React" }], total: 1 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await listTags();
      expect(result.tags).toHaveLength(1);
    });

    it("filters by tag type", async () => {
      const mockResponse = { tags: [], total: 0 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await listTags("topic");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("tag_type=topic"),
        expect.any(Object)
      );
    });
  });

  describe("getRepoTags", () => {
    it("returns tags for a repo", async () => {
      const mockResponse = { repo_id: 1, tags: [], total: 0 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getRepoTags(1);
      expect(result.repo_id).toBe(1);
    });
  });

  describe("addTagToRepo", () => {
    it("adds a tag to repo", async () => {
      const mockResponse = { repo_id: 1, tags: [{ id: 1, name: "custom" }], total: 1 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await addTagToRepo(1, "custom", "#ff0000");
      expect(result.tags).toHaveLength(1);
    });
  });

  describe("removeTagFromRepo", () => {
    it("removes a tag from repo", async () => {
      const mockResponse = { status: "success", message: "Tag removed" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await removeTagFromRepo(1, 5);
      expect(result.status).toBe("success");
    });
  });

  describe("autoTagRepo", () => {
    it("triggers auto-tagging", async () => {
      const mockResponse = { repo_id: 1, tags_applied: [], total_applied: 0 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await autoTagRepo(1);
      expect(result.repo_id).toBe(1);
    });
  });

  describe("searchByTags", () => {
    it("searches by tags", async () => {
      const mockResponse = { repos: [], total: 0 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await searchByTags(["react", "typescript"]);
      expect(result.total).toBe(0);
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
  });

  // Category API tests
  describe("listCategories", () => {
    it("returns all categories", async () => {
      const mockResponse = { categories: [{ id: 1, name: "Frontend" }], total: 1 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await listCategories();
      expect(result.categories).toHaveLength(1);
    });
  });

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

  // Comparison API tests
  describe("listComparisonGroups", () => {
    it("returns comparison groups", async () => {
      const mockResponse = { groups: [], total: 0 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await listComparisonGroups();
      expect(result.total).toBe(0);
    });
  });

  describe("getComparisonGroup", () => {
    it("returns group detail", async () => {
      const mockResponse = { group_id: 1, group_name: "Test", members: [], summary: {} };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getComparisonGroup(1);
      expect(result.group_id).toBe(1);
    });
  });

  describe("createComparisonGroup", () => {
    it("creates comparison group", async () => {
      const mockResponse = { id: 1, name: "New Group" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await createComparisonGroup("New Group", "Description");
      expect(result.name).toBe("New Group");
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

  describe("getHealthScore", () => {
    it("returns full health score", async () => {
      const mockResponse = {
        repo_id: 1,
        overall_score: 85,
        grade: "A",
        issue_response_score: 90,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getHealthScore(1);
      expect(result.overall_score).toBe(85);
    });
  });
});
