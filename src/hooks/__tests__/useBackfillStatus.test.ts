import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useBackfillStatus } from "../useBackfillStatus";
import * as apiClient from "../../api/client";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getBackfillStatus: vi.fn(),
  };
});

describe("useBackfillStatus", () => {
  const mockStatus: apiClient.BackfillStatus = {
    repo_id: 1,
    repo_name: "test/repo",
    can_backfill: true,
    current_stars: 100,
    max_stars_allowed: 5000,
    has_backfilled_data: false,
    backfilled_days: 0,
    message: "Ready to backfill",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.getBackfillStatus).mockReset();
  });

  it("returns initial loading state", () => {
    vi.mocked(apiClient.getBackfillStatus).mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useBackfillStatus(1, false));

    expect(result.current.loading).toBe(true);
    expect(result.current.status).toBe(null);
    expect(result.current.error).toBe(null);
    expect(result.current.isOffline).toBe(false);
  });

  it("loads status successfully", async () => {
    vi.mocked(apiClient.getBackfillStatus).mockResolvedValue(mockStatus);

    const { result } = renderHook(() => useBackfillStatus(1, false));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.status).toEqual(mockStatus);
    expect(result.current.error).toBe(null);
    expect(result.current.lastUpdated).toBeInstanceOf(Date);
  });

  it("does not load when exceedsStarLimit is true", async () => {
    vi.mocked(apiClient.getBackfillStatus).mockResolvedValue(mockStatus);

    const { result } = renderHook(() => useBackfillStatus(1, true));

    // Wait a tick to ensure effect has run
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(apiClient.getBackfillStatus).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it("handles 404 error by setting status to null", async () => {
    vi.mocked(apiClient.getBackfillStatus).mockRejectedValue(
      new apiClient.ApiError(404, "Not found")
    );

    const { result } = renderHook(() => useBackfillStatus(1, false));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.status).toBe(null);
    expect(result.current.error).toBe(null);
  });

  it("handles network error with offline state", async () => {
    vi.mocked(apiClient.getBackfillStatus).mockRejectedValue(new TypeError("Failed to fetch"));

    const { result } = renderHook(() => useBackfillStatus(1, false));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isOffline).toBe(true);
    expect(result.current.error).toBe("Offline - showing cached data");
  });

  it("handles other errors", async () => {
    vi.mocked(apiClient.getBackfillStatus).mockRejectedValue(
      new apiClient.ApiError(400, "Bad request")
    );

    const { result } = renderHook(() => useBackfillStatus(1, false));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Backfill failed");
  });

  it("exposes loadStatus function", async () => {
    vi.mocked(apiClient.getBackfillStatus).mockResolvedValue(mockStatus);

    const { result } = renderHook(() => useBackfillStatus(1, false));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(typeof result.current.loadStatus).toBe("function");
  });

  it("exposes setError function", async () => {
    vi.mocked(apiClient.getBackfillStatus).mockResolvedValue(mockStatus);

    const { result } = renderHook(() => useBackfillStatus(1, false));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(typeof result.current.setError).toBe("function");
  });
});
