import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRecentlyViewed, RecentlyViewedRepo } from "../useRecentlyViewed";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

function makeRepo(overrides: Partial<RecentlyViewedRepo> = {}): RecentlyViewedRepo {
  return {
    id: 1,
    full_name: "owner/repo",
    owner: "owner",
    name: "repo",
    language: "TypeScript",
    stars: 100,
    owner_avatar_url: "https://example.com/avatar.png",
    ...overrides,
  };
}

describe("useRecentlyViewed", () => {
  let storageData: Record<string, string>;

  beforeEach(() => {
    storageData = {};
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(
      (key: string) => storageData[key] ?? null
    );
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key: string, value: string) => {
      storageData[key] = value;
    });
  });

  it("starts empty when no saved data", () => {
    const { result } = renderHook(() => useRecentlyViewed());
    expect(result.current.recentRepos).toEqual([]);
  });

  it("loads existing data from localStorage", () => {
    const repos = [makeRepo({ id: 1 }), makeRepo({ id: 2, full_name: "other/repo" })];
    storageData["starscope_recently_viewed"] = JSON.stringify(repos);

    const { result } = renderHook(() => useRecentlyViewed());
    expect(result.current.recentRepos).toHaveLength(2);
    expect(result.current.recentRepos[0].full_name).toBe("owner/repo");
  });

  it("handles corrupted localStorage gracefully", () => {
    storageData["starscope_recently_viewed"] = "not-json{{{";

    const { result } = renderHook(() => useRecentlyViewed());
    expect(result.current.recentRepos).toEqual([]);
  });

  it("handles non-array JSON gracefully", () => {
    storageData["starscope_recently_viewed"] = JSON.stringify({ not: "an array" });

    const { result } = renderHook(() => useRecentlyViewed());
    expect(result.current.recentRepos).toEqual([]);
  });

  it("adds a repo to recently viewed", () => {
    const { result } = renderHook(() => useRecentlyViewed());
    const repo = makeRepo();

    act(() => {
      result.current.addToRecentlyViewed(repo);
    });

    expect(result.current.recentRepos).toEqual([repo]);
  });

  it("deduplicates by moving existing repo to front", () => {
    const repo1 = makeRepo({ id: 1, full_name: "a/first" });
    const repo2 = makeRepo({ id: 2, full_name: "b/second" });
    const repo3 = makeRepo({ id: 3, full_name: "c/third" });
    storageData["starscope_recently_viewed"] = JSON.stringify([repo1, repo2, repo3]);

    const { result } = renderHook(() => useRecentlyViewed());

    // Re-add repo2 with updated stars
    const updatedRepo2 = { ...repo2, stars: 999 };
    act(() => {
      result.current.addToRecentlyViewed(updatedRepo2);
    });

    expect(result.current.recentRepos[0].full_name).toBe("b/second");
    expect(result.current.recentRepos[0].stars).toBe(999);
    expect(result.current.recentRepos).toHaveLength(3);
  });

  it("enforces maximum of 20 items", () => {
    const { result } = renderHook(() => useRecentlyViewed());

    act(() => {
      for (let i = 0; i < 25; i++) {
        result.current.addToRecentlyViewed(makeRepo({ id: i, full_name: `owner/repo-${i}` }));
      }
    });

    expect(result.current.recentRepos).toHaveLength(20);
    // Most recent should be first
    expect(result.current.recentRepos[0].full_name).toBe("owner/repo-24");
  });

  it("clears all recently viewed", () => {
    storageData["starscope_recently_viewed"] = JSON.stringify([makeRepo()]);

    const { result } = renderHook(() => useRecentlyViewed());
    expect(result.current.recentRepos).toHaveLength(1);

    act(() => {
      result.current.clearRecentlyViewed();
    });

    expect(result.current.recentRepos).toEqual([]);
  });

  it("persists changes to localStorage", () => {
    const { result } = renderHook(() => useRecentlyViewed());
    const repo = makeRepo();

    act(() => {
      result.current.addToRecentlyViewed(repo);
    });

    const stored = storageData["starscope_recently_viewed"];
    expect(stored).toBeDefined();
    expect(JSON.parse(stored)).toEqual([repo]);
  });

  it("truncates stored data exceeding 20 items", () => {
    const repos = Array.from({ length: 25 }, (_, i) =>
      makeRepo({ id: i, full_name: `owner/repo-${i}` })
    );
    storageData["starscope_recently_viewed"] = JSON.stringify(repos);

    const { result } = renderHook(() => useRecentlyViewed());
    expect(result.current.recentRepos).toHaveLength(20);
  });

  it("handles localStorage setItem error gracefully", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    const { result } = renderHook(() => useRecentlyViewed());

    // Should not throw
    act(() => {
      result.current.addToRecentlyViewed(makeRepo());
    });

    expect(result.current.recentRepos).toHaveLength(1);
  });
});
