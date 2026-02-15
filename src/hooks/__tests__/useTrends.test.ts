import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useTrends, TrendingRepo } from "../useTrends";
import * as apiClient from "../../api/client";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getTrends: vi.fn(),
  };
});

vi.mock("../../constants/api", () => ({
  TRENDS_DEFAULT_LIMIT: 50,
}));

function makeTrendingRepo(overrides: Partial<TrendingRepo> = {}): TrendingRepo {
  return {
    id: 1,
    owner: "facebook",
    name: "react",
    full_name: "facebook/react",
    url: "https://github.com/facebook/react",
    description: "A JavaScript library",
    language: "JavaScript",
    stars: 200000,
    stars_delta_7d: 100,
    stars_delta_30d: 400,
    velocity: 14.3,
    acceleration: 0.5,
    trend: 1,
    rank: 1,
    ...overrides,
  };
}

const mockGetTrends = vi.mocked(apiClient.getTrends);

const defaultResponse = {
  repos: [makeTrendingRepo()],
  total: 1,
  sort_by: "velocity",
};

/** Render hook and wait for initial loading to complete. */
async function renderAndWaitForLoad(mockResponse = defaultResponse) {
  mockGetTrends.mockResolvedValue(mockResponse);
  const utils = renderHook(() => useTrends());
  await waitFor(() => {
    expect(utils.result.current.loading).toBe(false);
  });
  return utils;
}

/** Render hook with a rejected mock and wait for loading to complete. */
async function renderAndWaitForError(error: Error) {
  mockGetTrends.mockRejectedValue(error);
  const utils = renderHook(() => useTrends());
  await waitFor(() => {
    expect(utils.result.current.loading).toBe(false);
  });
  return utils;
}

/** Clear previous mock calls and set a new resolved response for the next fetch. */
function resetMockResponse(response = defaultResponse) {
  mockGetTrends.mockClear();
  mockGetTrends.mockResolvedValue(response);
}

describe("useTrends", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in loading state and fetches on mount", async () => {
    mockGetTrends.mockResolvedValue(defaultResponse);

    const { result } = renderHook(() => useTrends());

    // Should start loading
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.trends).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it("fetches with correct default params", async () => {
    mockGetTrends.mockResolvedValue(defaultResponse);

    renderHook(() => useTrends());

    await waitFor(() => {
      expect(apiClient.getTrends).toHaveBeenCalled();
    });

    expect(apiClient.getTrends).toHaveBeenCalledWith(
      expect.objectContaining({
        sortBy: "velocity",
        limit: 50,
      })
    );
  });

  it("sets error on API error", async () => {
    const { result } = await renderAndWaitForError(new Error("HTTP 500"));

    expect(result.current.error).toBe("HTTP 500");
    expect(result.current.trends).toHaveLength(0);
  });

  it("sets error on network error", async () => {
    const { result } = await renderAndWaitForError(new Error("Network failure"));

    expect(result.current.error).toBe("Network failure");
  });

  it("re-fetches when setSortBy is called", async () => {
    const { result } = await renderAndWaitForLoad();

    resetMockResponse({ ...defaultResponse, sort_by: "stars_delta_7d" });

    act(() => {
      result.current.setSortBy("stars_delta_7d");
    });

    await waitFor(() => {
      expect(apiClient.getTrends).toHaveBeenCalled();
    });

    expect(apiClient.getTrends).toHaveBeenCalledWith(
      expect.objectContaining({ sortBy: "stars_delta_7d" })
    );
  });

  it("includes language filter in request params", async () => {
    const { result } = await renderAndWaitForLoad();

    resetMockResponse();

    act(() => {
      result.current.setLanguageFilter("TypeScript");
    });

    await waitFor(() => {
      expect(apiClient.getTrends).toHaveBeenCalled();
    });

    expect(apiClient.getTrends).toHaveBeenCalledWith(
      expect.objectContaining({ language: "TypeScript" })
    );
  });

  it("includes min_stars filter in request params", async () => {
    const { result } = await renderAndWaitForLoad();

    resetMockResponse();

    act(() => {
      result.current.setMinStarsFilter(1000);
    });

    await waitFor(() => {
      expect(apiClient.getTrends).toHaveBeenCalled();
    });

    expect(apiClient.getTrends).toHaveBeenCalledWith(expect.objectContaining({ minStars: 1000 }));
  });

  it("computes availableLanguages from current results", async () => {
    const { result } = await renderAndWaitForLoad({
      repos: [
        makeTrendingRepo({ id: 1, language: "TypeScript" }),
        makeTrendingRepo({ id: 2, language: "JavaScript" }),
        makeTrendingRepo({ id: 3, language: "TypeScript" }),
        makeTrendingRepo({ id: 4, language: null }),
      ],
      total: 4,
      sort_by: "velocity",
    });

    // Should be deduplicated and sorted
    expect(result.current.availableLanguages).toEqual(["JavaScript", "TypeScript"]);
  });

  it("retry triggers a new fetch", async () => {
    const { result } = await renderAndWaitForError(new Error("Network failure"));

    expect(result.current.error).toBe("Network failure");

    resetMockResponse();

    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.trends).toHaveLength(1);
  });
});
