import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBackfillAction } from "../useBackfillAction";
import * as apiClient from "../../api/client";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    backfillStarHistory: vi.fn(),
  };
});


describe("useBackfillAction", () => {
  const mockOnSuccess = vi.fn().mockResolvedValue(undefined);
  const mockOnComplete = vi.fn();
  const mockSetError = vi.fn();

  const defaultProps = {
    repoId: 1,
    isOffline: false,
    onSuccess: mockOnSuccess,
    onComplete: mockOnComplete,
    setError: mockSetError,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns initial state", () => {
    const { result } = renderHook(() => useBackfillAction(defaultProps));

    expect(result.current.backfilling).toBe(false);
    expect(result.current.successMessage).toBe(null);
    expect(typeof result.current.handleBackfill).toBe("function");
  });

  it("sets error when offline", async () => {
    const { result } = renderHook(() => useBackfillAction({ ...defaultProps, isOffline: true }));

    await act(async () => {
      await result.current.handleBackfill();
    });

    expect(mockSetError).toHaveBeenCalledWith("Cannot backfill while offline");
    expect(apiClient.backfillStarHistory).not.toHaveBeenCalled();
  });

  it("handles successful backfill", async () => {
    vi.mocked(apiClient.backfillStarHistory).mockResolvedValue({
      repo_id: 1,
      repo_name: "test/repo",
      success: true,
      total_stargazers: 100,
      snapshots_created: 5,
      earliest_date: "2024-01-01",
      latest_date: "2024-01-31",
      message: "Success",
    });

    const { result } = renderHook(() => useBackfillAction(defaultProps));

    await act(async () => {
      await result.current.handleBackfill();
    });

    await waitFor(() => {
      expect(result.current.backfilling).toBe(false);
    });

    expect(result.current.successMessage).toBe("Backfill complete! Created 5 data points.");
    expect(mockOnSuccess).toHaveBeenCalled();
    expect(mockOnComplete).toHaveBeenCalled();
  });

  it("handles unsuccessful backfill response", async () => {
    vi.mocked(apiClient.backfillStarHistory).mockResolvedValue({
      repo_id: 1,
      repo_name: "test/repo",
      success: false,
      total_stargazers: 0,
      snapshots_created: 0,
      earliest_date: null,
      latest_date: null,
      message: "Repository not found",
    });

    const { result } = renderHook(() => useBackfillAction(defaultProps));

    await act(async () => {
      await result.current.handleBackfill();
    });

    expect(mockSetError).toHaveBeenCalledWith("Repository not found");
    expect(mockOnSuccess).not.toHaveBeenCalled();
  });

  it("handles API error", async () => {
    vi.mocked(apiClient.backfillStarHistory).mockRejectedValue(
      new apiClient.ApiError(500, "Server error")
    );

    const { result } = renderHook(() => useBackfillAction(defaultProps));

    await act(async () => {
      await result.current.handleBackfill();
    });

    expect(mockSetError).toHaveBeenCalledWith("Cannot backfill while offline");
    expect(result.current.backfilling).toBe(false);
  });

  it("sets backfilling state during operation", async () => {
    let resolveBackfill: ((value: apiClient.BackfillResult) => void) | null = null;
    vi.mocked(apiClient.backfillStarHistory).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBackfill = resolve;
        })
    );

    const { result } = renderHook(() => useBackfillAction(defaultProps));

    act(() => {
      void result.current.handleBackfill();
    });

    expect(result.current.backfilling).toBe(true);

    await act(async () => {
      if (resolveBackfill) {
        resolveBackfill({
          repo_id: 1,
          repo_name: "test/repo",
          success: true,
          total_stargazers: 10,
          snapshots_created: 1,
          earliest_date: "2024-01-01",
          latest_date: "2024-01-01",
          message: "",
        });
      }
    });

    expect(result.current.backfilling).toBe(false);
  });
});
