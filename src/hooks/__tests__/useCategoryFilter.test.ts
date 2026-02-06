import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCategoryFilter } from "../useCategoryFilter";
import * as apiClient from "../../api/client";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getCategoryRepos: vi.fn(),
  };
});

function makeRepo(overrides: Partial<apiClient.RepoWithSignals> = {}): apiClient.RepoWithSignals {
  return {
    id: 1,
    owner: "facebook",
    name: "react",
    full_name: "facebook/react",
    url: "https://github.com/facebook/react",
    description: "A JavaScript library",
    language: "JavaScript",
    added_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    stars: 200000,
    forks: 40000,
    stars_delta_7d: 100,
    stars_delta_30d: 400,
    velocity: 14.3,
    acceleration: 0.5,
    trend: 1,
    last_fetched: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

const testRepos = [
  makeRepo({
    id: 1,
    full_name: "facebook/react",
    description: "A JavaScript library",
    language: "JavaScript",
  }),
  makeRepo({
    id: 2,
    full_name: "vuejs/vue",
    description: "Progressive framework",
    language: "TypeScript",
  }),
  makeRepo({
    id: 3,
    full_name: "angular/angular",
    description: "Platform for web apps",
    language: "TypeScript",
  }),
];

describe("useCategoryFilter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows all repos when no category selected", () => {
    const { result } = renderHook(() => useCategoryFilter(testRepos));

    expect(result.current.displayedRepos).toHaveLength(3);
    expect(result.current.selectedCategoryId).toBeNull();
  });

  it("filters repos by category", async () => {
    vi.mocked(apiClient.getCategoryRepos).mockResolvedValue({
      category_id: 1,
      category_name: "Test",
      repos: [{ id: 1 }, { id: 3 }] as apiClient.CategoryReposResponse["repos"],
      total: 2,
    });

    const { result } = renderHook(() => useCategoryFilter(testRepos));

    await act(async () => {
      result.current.setSelectedCategoryId(1);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.displayedRepos).toHaveLength(2);
    expect(result.current.displayedRepos.map((r) => r.id)).toEqual([1, 3]);
  });

  it("filters repos by search query (full_name)", async () => {
    const { result } = renderHook(() => useCategoryFilter(testRepos));

    act(() => {
      result.current.setSearchQuery("react");
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.displayedRepos).toHaveLength(1);
    expect(result.current.displayedRepos[0].full_name).toBe("facebook/react");
  });

  it("filters repos by search query (description)", async () => {
    const { result } = renderHook(() => useCategoryFilter(testRepos));

    act(() => {
      result.current.setSearchQuery("progressive");
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.displayedRepos).toHaveLength(1);
    expect(result.current.displayedRepos[0].full_name).toBe("vuejs/vue");
  });

  it("filters repos by search query (language)", async () => {
    const { result } = renderHook(() => useCategoryFilter(testRepos));

    act(() => {
      result.current.setSearchQuery("typescript");
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.displayedRepos).toHaveLength(2);
  });

  it("combines category and search filters", async () => {
    vi.mocked(apiClient.getCategoryRepos).mockResolvedValue({
      category_id: 1,
      category_name: "Test",
      repos: [{ id: 1 }, { id: 2 }] as apiClient.CategoryReposResponse["repos"],
      total: 2,
    });

    const { result } = renderHook(() => useCategoryFilter(testRepos));

    await act(async () => {
      result.current.setSelectedCategoryId(1);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.displayedRepos).toHaveLength(2);

    act(() => {
      result.current.setSearchQuery("react");
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.displayedRepos).toHaveLength(1);
    expect(result.current.displayedRepos[0].full_name).toBe("facebook/react");
  });

  it("debounces search query with 300ms delay", async () => {
    const { result } = renderHook(() => useCategoryFilter(testRepos));

    act(() => {
      result.current.setSearchQuery("react");
    });

    // Before debounce, all repos should still show
    expect(result.current.displayedRepos).toHaveLength(3);

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.displayedRepos).toHaveLength(1);
  });

  it("falls back to showing all repos on API error", async () => {
    vi.mocked(apiClient.getCategoryRepos).mockRejectedValue(new Error("API error"));

    const { result } = renderHook(() => useCategoryFilter(testRepos));

    await act(async () => {
      result.current.setSelectedCategoryId(1);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.displayedRepos).toHaveLength(3);
  });
});
