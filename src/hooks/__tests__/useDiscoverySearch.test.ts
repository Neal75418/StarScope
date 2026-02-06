import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDiscoverySearch } from "../useDiscoverySearch";
import { DiscoveryRepo } from "../../api/client";
import * as searchHelpers from "../../utils/searchHelpers";

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: {
      discovery: {
        error: {
          generic: "Search error",
          rateLimit: "Rate limited",
        },
      },
    },
  }),
}));

vi.mock("../../utils/searchHelpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/searchHelpers")>();
  return {
    ...actual,
    fetchSearchResults: vi.fn(),
  };
});

function makeDiscoveryRepo(overrides: Partial<DiscoveryRepo> = {}): DiscoveryRepo {
  return {
    id: 1,
    full_name: "facebook/react",
    owner: "facebook",
    name: "react",
    description: null,
    language: "JavaScript",
    stars: 200000,
    forks: 40000,
    url: "https://github.com/facebook/react",
    topics: [],
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("useDiscoverySearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct initial state", () => {
    const { result } = renderHook(() => useDiscoverySearch());

    expect(result.current.repos).toEqual([]);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("executes search and returns results", async () => {
    vi.mocked(searchHelpers.fetchSearchResults).mockResolvedValue({
      repos: [makeDiscoveryRepo()],
      totalCount: 1,
      hasMore: false,
    });

    const { result } = renderHook(() => useDiscoverySearch());

    await act(async () => {
      await result.current.executeSearch("react", undefined, {}, 1);
    });

    expect(result.current.repos).toHaveLength(1);
    expect(result.current.totalCount).toBe(1);
    expect(result.current.loading).toBe(false);
  });

  it("appends results for page > 1", async () => {
    const repo1 = makeDiscoveryRepo({ id: 1, full_name: "a/b" });
    const repo2 = makeDiscoveryRepo({ id: 2, full_name: "c/d" });

    vi.mocked(searchHelpers.fetchSearchResults).mockResolvedValueOnce({
      repos: [repo1],
      totalCount: 2,
      hasMore: true,
    });

    const { result } = renderHook(() => useDiscoverySearch());

    await act(async () => {
      await result.current.executeSearch("test", undefined, {}, 1);
    });

    expect(result.current.repos).toHaveLength(1);

    vi.mocked(searchHelpers.fetchSearchResults).mockResolvedValueOnce({
      repos: [repo2],
      totalCount: 2,
      hasMore: false,
    });

    await act(async () => {
      await result.current.executeSearch("test", undefined, {}, 2);
    });

    expect(result.current.repos).toHaveLength(2);
  });

  it("resets state for empty query", async () => {
    vi.mocked(searchHelpers.fetchSearchResults).mockResolvedValueOnce({
      repos: [makeDiscoveryRepo()],
      totalCount: 1,
      hasMore: false,
    });

    const { result } = renderHook(() => useDiscoverySearch());

    await act(async () => {
      await result.current.executeSearch("react", undefined, {}, 1);
    });
    expect(result.current.repos).toHaveLength(1);

    await act(async () => {
      await result.current.executeSearch("", undefined, {}, 1);
    });

    expect(result.current.repos).toEqual([]);
    expect(result.current.totalCount).toBe(0);
    expect(searchHelpers.fetchSearchResults).toHaveBeenCalledTimes(1);
  });

  it("handles search error gracefully", async () => {
    vi.mocked(searchHelpers.fetchSearchResults).mockRejectedValue(new Error("Network fail"));

    const { result } = renderHook(() => useDiscoverySearch());

    await act(async () => {
      await result.current.executeSearch("test", undefined, {}, 1);
    });

    expect(result.current.error).toBe("Search error");
    expect(result.current.loading).toBe(false);
  });

  it("resetSearch clears all state", async () => {
    vi.mocked(searchHelpers.fetchSearchResults).mockResolvedValueOnce({
      repos: [makeDiscoveryRepo()],
      totalCount: 1,
      hasMore: false,
    });

    const { result } = renderHook(() => useDiscoverySearch());

    await act(async () => {
      await result.current.executeSearch("react", undefined, {}, 1);
    });
    expect(result.current.repos).toHaveLength(1);

    act(() => {
      result.current.resetSearch();
    });

    expect(result.current.repos).toEqual([]);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.loading).toBe(false);
  });
});
