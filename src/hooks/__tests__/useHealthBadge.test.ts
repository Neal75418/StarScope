import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useHealthBadge } from "../useHealthBadge";
import * as apiClient from "../../api/client";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getHealthScoreSummary: vi.fn(),
    calculateHealthScore: vi.fn(),
    getHealthScore: vi.fn(),
  };
});

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: {
      healthScore: {
        failedToLoad: "Failed to load",
        calculationFailed: "Calculation failed",
      },
    },
  }),
}));

describe("useHealthBadge", () => {
  const mockSummary: apiClient.HealthScoreSummary = {
    repo_id: 1,
    overall_score: 85,
    grade: "A",
    calculated_at: "2024-01-01T00:00:00Z",
  };

  const mockDetails: apiClient.HealthScoreResponse = {
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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.getHealthScoreSummary).mockReset();
    vi.mocked(apiClient.calculateHealthScore).mockReset();
    vi.mocked(apiClient.getHealthScore).mockReset();
  });

  it("returns initial loading state", () => {
    vi.mocked(apiClient.getHealthScoreSummary).mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useHealthBadge({ repoId: 1 }));

    expect(result.current.loading).toBe(true);
    expect(result.current.summary).toBe(null);
  });

  it("loads summary successfully", async () => {
    vi.mocked(apiClient.getHealthScoreSummary).mockResolvedValue(mockSummary);

    const { result } = renderHook(() => useHealthBadge({ repoId: 1 }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.summary).toEqual(mockSummary);
  });

  it("handles 404 as no score calculated", async () => {
    const error404 = { status: 404, detail: "Not found" };
    vi.mocked(apiClient.getHealthScoreSummary).mockRejectedValue(error404);

    const { result } = renderHook(() => useHealthBadge({ repoId: 1 }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.summary).toBe(null);
    expect(result.current.error).toBe(null);
  });

  it("handles non-404 error", async () => {
    const error500 = { status: 500, detail: "Server error" };
    vi.mocked(apiClient.getHealthScoreSummary).mockRejectedValue(error500);

    const { result } = renderHook(() => useHealthBadge({ repoId: 1 }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to load");
  });

  it("handleClick calculates when no summary", async () => {
    const error404 = { status: 404, detail: "Not found" };
    vi.mocked(apiClient.getHealthScoreSummary).mockRejectedValue(error404);
    vi.mocked(apiClient.calculateHealthScore).mockResolvedValue(mockDetails);

    const { result } = renderHook(() => useHealthBadge({ repoId: 1 }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Trigger the click and wait for calculation to be called
    act(() => {
      result.current.handleClick();
    });

    await waitFor(() => {
      expect(apiClient.calculateHealthScore).toHaveBeenCalledWith(1);
    });
  });

  it("handleClick shows details when summary exists", async () => {
    vi.mocked(apiClient.getHealthScoreSummary).mockResolvedValue(mockSummary);
    vi.mocked(apiClient.getHealthScore).mockResolvedValue(mockDetails);

    const mockOnShowDetails = vi.fn();
    const { result } = renderHook(() =>
      useHealthBadge({ repoId: 1, onShowDetails: mockOnShowDetails })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.handleClick();
    });

    expect(apiClient.getHealthScore).toHaveBeenCalledWith(1);
    expect(mockOnShowDetails).toHaveBeenCalledWith(mockDetails);
  });

  it("exposes handleCalculate function", async () => {
    vi.mocked(apiClient.getHealthScoreSummary).mockResolvedValue(mockSummary);

    const { result } = renderHook(() => useHealthBadge({ repoId: 1 }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(typeof result.current.handleCalculate).toBe("function");
    expect(typeof result.current.handleClick).toBe("function");
  });
});
