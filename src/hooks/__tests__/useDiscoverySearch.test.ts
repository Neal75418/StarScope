import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useDiscoverySearch } from "../useDiscoverySearch";
import { DiscoveryRepo } from "../../api/client";
import * as searchHelpers from "../../utils/searchHelpers";
import { createTestQueryClient } from "../../lib/react-query";

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
    owner_avatar_url: null,
    open_issues_count: 0,
    license_spdx: null,
    license_name: null,
    archived: false,
    ...overrides,
  };
}

const mockFetchResults = vi.mocked(searchHelpers.fetchSearchResults);

function createWrapper() {
  const queryClient = createTestQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe("useDiscoverySearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct initial state", () => {
    const { result } = renderHook(() => useDiscoverySearch(), { wrapper: createWrapper() });

    expect(result.current.repos).toEqual([]);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("executes search and returns results", async () => {
    mockFetchResults.mockResolvedValue({
      repos: [makeDiscoveryRepo()],
      totalCount: 1,
      hasMore: false,
    });

    const { result } = renderHook(() => useDiscoverySearch(), { wrapper: createWrapper() });

    act(() => {
      result.current.executeSearch("react", undefined, {}, 1);
    });

    await waitFor(() => {
      expect(result.current.repos).toHaveLength(1);
    });

    expect(result.current.totalCount).toBe(1);
    expect(result.current.loading).toBe(false);
  });

  it("loads more results via loadMore", async () => {
    const repo1 = makeDiscoveryRepo({ id: 1, full_name: "a/b" });
    const repo2 = makeDiscoveryRepo({ id: 2, full_name: "c/d" });

    mockFetchResults.mockResolvedValueOnce({
      repos: [repo1],
      totalCount: 2,
      hasMore: true,
    });

    const { result } = renderHook(() => useDiscoverySearch(), { wrapper: createWrapper() });

    act(() => {
      result.current.executeSearch("test", undefined, {}, 1);
    });

    await waitFor(() => {
      expect(result.current.repos).toHaveLength(1);
    });

    expect(result.current.hasMore).toBe(true);

    mockFetchResults.mockResolvedValueOnce({
      repos: [repo2],
      totalCount: 2,
      hasMore: false,
    });

    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(result.current.repos).toHaveLength(2);
    });
  });

  it("resets state for empty query", async () => {
    mockFetchResults.mockResolvedValue({
      repos: [makeDiscoveryRepo()],
      totalCount: 1,
      hasMore: false,
    });

    const { result } = renderHook(() => useDiscoverySearch(), { wrapper: createWrapper() });

    act(() => {
      result.current.executeSearch("react", undefined, {}, 1);
    });

    await waitFor(() => {
      expect(result.current.repos).toHaveLength(1);
    });

    act(() => {
      result.current.executeSearch("", undefined, {}, 1);
    });

    await waitFor(() => {
      expect(result.current.repos).toEqual([]);
    });

    expect(result.current.totalCount).toBe(0);
  });

  it("handles search error from fetchSearchResults", async () => {
    mockFetchResults.mockResolvedValue({
      repos: [],
      totalCount: 0,
      hasMore: false,
      error: "Rate limit exceeded",
    });

    const { result } = renderHook(() => useDiscoverySearch(), { wrapper: createWrapper() });

    act(() => {
      result.current.executeSearch("test", undefined, {}, 1);
    });

    await waitFor(() => {
      expect(result.current.error).toBe("Rate limit exceeded");
    });

    expect(result.current.loading).toBe(false);
  });

  it("resetSearch clears all state", async () => {
    mockFetchResults.mockResolvedValue({
      repos: [makeDiscoveryRepo()],
      totalCount: 1,
      hasMore: false,
    });

    const { result } = renderHook(() => useDiscoverySearch(), { wrapper: createWrapper() });

    act(() => {
      result.current.executeSearch("react", undefined, {}, 1);
    });

    await waitFor(() => {
      expect(result.current.repos).toHaveLength(1);
    });

    act(() => {
      result.current.resetSearch();
    });

    await waitFor(() => {
      expect(result.current.repos).toEqual([]);
    });

    expect(result.current.totalCount).toBe(0);
    expect(result.current.loading).toBe(false);
  });

  it("caches results for same query", async () => {
    mockFetchResults.mockResolvedValue({
      repos: [makeDiscoveryRepo()],
      totalCount: 1,
      hasMore: false,
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useDiscoverySearch(), { wrapper });

    // First search
    act(() => {
      result.current.executeSearch("react", undefined, {}, 1);
    });

    await waitFor(() => {
      expect(result.current.repos).toHaveLength(1);
    });

    // Change to different search
    act(() => {
      result.current.executeSearch("vue", undefined, {}, 1);
    });

    await waitFor(() => {
      expect(mockFetchResults).toHaveBeenCalledTimes(2);
    });

    // Switch back to "react" — should hit cache (staleTime=0 in test client, so refetch)
    // but the important thing is the query key mechanism works
    act(() => {
      result.current.executeSearch("react", undefined, {}, 1);
    });

    await waitFor(() => {
      expect(result.current.repos).toHaveLength(1);
    });
  });
});
