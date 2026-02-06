import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useTrends, TrendingRepo } from "../useTrends";

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: {
      trends: {
        loadingError: "Failed to load trends",
      },
    },
  }),
}));

vi.mock("../../config", () => ({
  API_ENDPOINT: "http://localhost:8008/api",
}));

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

const defaultResponse = {
  repos: [makeTrendingRepo()],
  total: 1,
  sort_by: "velocity",
};

describe("useTrends", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("starts in loading state and fetches on mount", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(defaultResponse),
    } as Response);

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
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(defaultResponse),
    } as Response);

    renderHook(() => useTrends());

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const calledUrl = vi.mocked(global.fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain("sort_by=velocity");
    expect(calledUrl).toContain("limit=50");
  });

  it("sets error on HTTP error response", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    } as Response);

    const { result } = renderHook(() => useTrends());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("HTTP 500");
    expect(result.current.trends).toHaveLength(0);
  });

  it("sets error on network error", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("Network failure"));

    const { result } = renderHook(() => useTrends());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Network failure");
  });

  it("re-fetches when setSortBy is called", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(defaultResponse),
    } as Response);

    const { result } = renderHook(() => useTrends());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    vi.mocked(global.fetch).mockClear();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ...defaultResponse, sort_by: "stars_delta_7d" }),
    } as Response);

    act(() => {
      result.current.setSortBy("stars_delta_7d");
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const calledUrl = vi.mocked(global.fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain("sort_by=stars_delta_7d");
  });

  it("includes language filter in request params", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(defaultResponse),
    } as Response);

    const { result } = renderHook(() => useTrends());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    vi.mocked(global.fetch).mockClear();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(defaultResponse),
    } as Response);

    act(() => {
      result.current.setLanguageFilter("TypeScript");
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const calledUrl = vi.mocked(global.fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain("language=TypeScript");
  });

  it("includes min_stars filter in request params", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(defaultResponse),
    } as Response);

    const { result } = renderHook(() => useTrends());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    vi.mocked(global.fetch).mockClear();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(defaultResponse),
    } as Response);

    act(() => {
      result.current.setMinStarsFilter(1000);
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const calledUrl = vi.mocked(global.fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain("min_stars=1000");
  });

  it("computes availableLanguages from current results", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          repos: [
            makeTrendingRepo({ id: 1, language: "TypeScript" }),
            makeTrendingRepo({ id: 2, language: "JavaScript" }),
            makeTrendingRepo({ id: 3, language: "TypeScript" }),
            makeTrendingRepo({ id: 4, language: null }),
          ],
          total: 4,
          sort_by: "velocity",
        }),
    } as Response);

    const { result } = renderHook(() => useTrends());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should be deduplicated and sorted
    expect(result.current.availableLanguages).toEqual(["JavaScript", "TypeScript"]);
  });

  it("retry triggers a new fetch", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("Network failure"));

    const { result } = renderHook(() => useTrends());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Network failure");

    vi.mocked(global.fetch).mockClear();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(defaultResponse),
    } as Response);

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
