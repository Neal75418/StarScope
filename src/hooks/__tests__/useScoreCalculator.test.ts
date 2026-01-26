import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useScoreCalculator } from "../useScoreCalculator";
import * as apiClient from "../../api/client";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    calculateHealthScore: vi.fn(),
  };
});

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: {
      healthScore: {
        calculationFailed: "Failed to calculate health score",
      },
    },
  }),
}));

describe("useScoreCalculator", () => {
  const mockHealthScoreResponse: apiClient.HealthScoreResponse = {
    repo_id: 1,
    repo_name: "test/repo",
    overall_score: 85,
    grade: "A",
    issue_response_score: 90,
    pr_merge_score: 85,
    release_cadence_score: 80,
    bus_factor_score: 75,
    documentation_score: 95,
    dependency_score: 80,
    velocity_score: 70,
    commit_activity_score: 85,
    metrics: null,
    calculated_at: "2024-01-01T00:00:00Z",
  };

  const mockSetSummary = vi.fn();
  const mockSetError = vi.fn();
  const mockOnShowDetails = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.calculateHealthScore).mockReset();
  });

  it("returns initial state", () => {
    const isMountedRef = { current: true };

    const { result } = renderHook(() =>
      useScoreCalculator({
        repoId: 1,
        isMountedRef,
        setSummary: mockSetSummary,
        setError: mockSetError,
      })
    );

    expect(result.current.calculating).toBe(false);
    expect(typeof result.current.handleCalculate).toBe("function");
  });

  it("calculates health score successfully", async () => {
    vi.mocked(apiClient.calculateHealthScore).mockResolvedValue(mockHealthScoreResponse);
    const isMountedRef = { current: true };

    const { result } = renderHook(() =>
      useScoreCalculator({
        repoId: 1,
        isMountedRef,
        setSummary: mockSetSummary,
        setError: mockSetError,
        onShowDetails: mockOnShowDetails,
      })
    );

    await act(async () => {
      await result.current.handleCalculate();
    });

    expect(apiClient.calculateHealthScore).toHaveBeenCalledWith(1);
    expect(mockSetSummary).toHaveBeenCalledWith({
      repo_id: 1,
      overall_score: 85,
      grade: "A",
      calculated_at: "2024-01-01T00:00:00Z",
    });
    expect(mockOnShowDetails).toHaveBeenCalledWith(mockHealthScoreResponse);
    expect(result.current.calculating).toBe(false);
  });

  it("handles calculation error", async () => {
    vi.mocked(apiClient.calculateHealthScore).mockRejectedValue(new Error("Network error"));
    const isMountedRef = { current: true };

    const { result } = renderHook(() =>
      useScoreCalculator({
        repoId: 1,
        isMountedRef,
        setSummary: mockSetSummary,
        setError: mockSetError,
      })
    );

    await act(async () => {
      await result.current.handleCalculate();
    });

    expect(mockSetError).toHaveBeenCalledWith("Failed to calculate health score");
    expect(result.current.calculating).toBe(false);
  });

  it("does not update state when unmounted", async () => {
    vi.mocked(apiClient.calculateHealthScore).mockResolvedValue(mockHealthScoreResponse);
    const isMountedRef = { current: false };

    const { result } = renderHook(() =>
      useScoreCalculator({
        repoId: 1,
        isMountedRef,
        setSummary: mockSetSummary,
        setError: mockSetError,
      })
    );

    await act(async () => {
      await result.current.handleCalculate();
    });

    expect(mockSetSummary).not.toHaveBeenCalled();
  });

  it("works without onShowDetails callback", async () => {
    vi.mocked(apiClient.calculateHealthScore).mockResolvedValue(mockHealthScoreResponse);
    const isMountedRef = { current: true };

    const { result } = renderHook(() =>
      useScoreCalculator({
        repoId: 1,
        isMountedRef,
        setSummary: mockSetSummary,
        setError: mockSetError,
      })
    );

    await act(async () => {
      await result.current.handleCalculate();
    });

    expect(mockSetSummary).toHaveBeenCalled();
  });
});
