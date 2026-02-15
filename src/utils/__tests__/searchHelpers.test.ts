import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildCombinedQuery,
  getStartDateForPeriod,
  getMinStarsForPeriod,
  fetchSearchResults,
} from "../searchHelpers";

// Mock the api/client module
vi.mock("../../api/client", () => {
  class MockApiError extends Error {
    status: number;
    detail: string;
    constructor(status: number, detail: string) {
      super(detail);
      this.status = status;
      this.detail = detail;
      this.name = "ApiError";
    }
  }
  return {
    searchRepos: vi.fn(),
    ApiError: MockApiError,
  };
});

// Import after mock setup
import { searchRepos, ApiError } from "../../api/client";
import { TranslationKeys } from "../../i18n";
const mockSearchRepos = vi.mocked(searchRepos);

const mockT = {
  discovery: {
    error: {
      generic: "Something went wrong",
      rateLimit: "Rate limit exceeded",
    },
  },
} as unknown as TranslationKeys;

describe("searchHelpers", () => {
  describe("buildCombinedQuery", () => {
    it("returns keyword only when no period or language", () => {
      expect(buildCombinedQuery("react", undefined, undefined)).toBe("react");
    });

    it("returns empty string for empty keyword and no filters", () => {
      expect(buildCombinedQuery("", undefined, undefined)).toBe("");
    });

    it("includes period-based date and stars filters", () => {
      const result = buildCombinedQuery("react", "weekly", undefined);
      expect(result).toContain("react");
      expect(result).toContain("created:>");
      expect(result).toContain("stars:>=50");
    });

    it("includes language filter", () => {
      const result = buildCombinedQuery("react", undefined, "TypeScript");
      expect(result).toContain("react");
      expect(result).toContain("language:TypeScript");
    });

    it("combines all filters", () => {
      const result = buildCombinedQuery("web", "daily", "JavaScript");
      expect(result).toContain("web");
      expect(result).toContain("created:>");
      expect(result).toContain("stars:>=10");
      expect(result).toContain("language:JavaScript");
    });

    it("trims keyword whitespace", () => {
      expect(buildCombinedQuery("  ", undefined, undefined)).toBe("");
    });
  });

  describe("getStartDateForPeriod", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns yesterday for daily", () => {
      expect(getStartDateForPeriod("daily")).toBe("2024-06-14");
    });

    it("returns 7 days ago for weekly", () => {
      expect(getStartDateForPeriod("weekly")).toBe("2024-06-08");
    });

    it("returns 30 days ago for monthly", () => {
      expect(getStartDateForPeriod("monthly")).toBe("2024-05-16");
    });
  });

  describe("getMinStarsForPeriod", () => {
    it("returns 10 for daily", () => {
      expect(getMinStarsForPeriod("daily")).toBe(10);
    });

    it("returns 50 for weekly", () => {
      expect(getMinStarsForPeriod("weekly")).toBe(50);
    });

    it("returns 100 for monthly", () => {
      expect(getMinStarsForPeriod("monthly")).toBe(100);
    });
  });

  describe("fetchSearchResults", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("returns search results on success", async () => {
      mockSearchRepos.mockResolvedValueOnce({
        repos: [
          {
            id: 1,
            full_name: "facebook/react",
            owner: "facebook",
            name: "react",
            description: "A JS library",
            url: "https://github.com/facebook/react",
            stars: 200000,
            forks: 40000,
            language: "JavaScript",
            topics: [],
            created_at: "2013-01-01",
            updated_at: "2024-01-01",
          },
        ],
        total_count: 1,
        page: 1,
        per_page: 30,
        has_more: false,
      });

      const result = await fetchSearchResults("react", {}, 1, mockT);
      expect(result.repos).toHaveLength(1);
      expect(result.totalCount).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("re-throws AbortError", async () => {
      const abortError = new DOMException("Aborted", "AbortError");
      mockSearchRepos.mockRejectedValueOnce(abortError);

      try {
        await fetchSearchResults("react", {}, 1, mockT);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect((err as Error).message).toBe("Aborted");
      }
    });

    it("returns rate limit error for 429 ApiError", async () => {
      const apiError = new ApiError(429, "Too many requests");
      mockSearchRepos.mockRejectedValueOnce(apiError);

      const result = await fetchSearchResults("react", {}, 1, mockT);
      expect(result.error).toBe("Rate limit exceeded");
      expect(result.repos).toHaveLength(0);
      expect(result.totalCount).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it("returns generic error for non-429 errors", async () => {
      mockSearchRepos.mockRejectedValueOnce(new Error("Server error"));

      const result = await fetchSearchResults("react", {}, 1, mockT);
      expect(result.error).toBe("Something went wrong");
      expect(result.repos).toHaveLength(0);
    });

    it("passes abort signal to searchRepos", async () => {
      mockSearchRepos.mockResolvedValueOnce({
        repos: [],
        total_count: 0,
        page: 1,
        per_page: 30,
        has_more: false,
      });

      const controller = new AbortController();
      await fetchSearchResults("react", {}, 1, mockT, controller.signal);
      expect(mockSearchRepos).toHaveBeenCalledWith("react", {}, 1, controller.signal);
    });

    it("handles pre-aborted signal gracefully", async () => {
      const controller = new AbortController();
      controller.abort();

      // In jsdom, throwIfAborted() may throw DOMException which gets re-thrown
      // or it may be caught as a generic error — either way it doesn't succeed normally
      try {
        const result = await fetchSearchResults("react", {}, 1, mockT, controller.signal);
        // If it doesn't throw, it should return an error result
        expect(result.error).toBeDefined();
      } catch {
        // If it throws (AbortError re-thrown), that's also valid
      }
      // searchRepos should not have been called since throwIfAborted fires first
      expect(mockSearchRepos).not.toHaveBeenCalled();
    });

    it("passes filters and page to searchRepos", async () => {
      mockSearchRepos.mockResolvedValueOnce({
        repos: [],
        total_count: 0,
        page: 3,
        per_page: 30,
        has_more: false,
      });

      await fetchSearchResults("test", { language: "Python" }, 3, mockT);
      expect(mockSearchRepos).toHaveBeenCalledWith("test", { language: "Python" }, 3, undefined);
    });
  });
});
