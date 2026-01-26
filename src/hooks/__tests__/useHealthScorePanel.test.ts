import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHealthScorePanel } from "../useHealthScorePanel";
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
        recalculateFailed: "Failed to recalculate",
      },
    },
  }),
}));

describe("useHealthScorePanel", () => {
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

  const mockOnClose = vi.fn();
  const mockOnRecalculate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.calculateHealthScore).mockReset();
  });

  it("returns initial state", () => {
    const { result } = renderHook(() =>
      useHealthScorePanel({
        repoId: 1,
        onClose: mockOnClose,
      })
    );

    expect(result.current.recalculating).toBe(false);
    expect(result.current.error).toBe(null);
    expect(typeof result.current.handleRecalculate).toBe("function");
  });

  it("recalculates health score successfully", async () => {
    vi.mocked(apiClient.calculateHealthScore).mockResolvedValue(mockHealthScoreResponse);

    const { result } = renderHook(() =>
      useHealthScorePanel({
        repoId: 1,
        onClose: mockOnClose,
        onRecalculate: mockOnRecalculate,
      })
    );

    await act(async () => {
      await result.current.handleRecalculate();
    });

    expect(apiClient.calculateHealthScore).toHaveBeenCalledWith(1);
    expect(mockOnRecalculate).toHaveBeenCalledWith(mockHealthScoreResponse);
    expect(result.current.recalculating).toBe(false);
  });

  it("handles recalculation error", async () => {
    vi.mocked(apiClient.calculateHealthScore).mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() =>
      useHealthScorePanel({
        repoId: 1,
        onClose: mockOnClose,
      })
    );

    await act(async () => {
      await result.current.handleRecalculate();
    });

    expect(result.current.error).toBe("Failed to recalculate");
    expect(result.current.recalculating).toBe(false);
  });

  it("calls onClose when Escape key is pressed", async () => {
    renderHook(() =>
      useHealthScorePanel({
        repoId: 1,
        onClose: mockOnClose,
      })
    );

    const event = new KeyboardEvent("keydown", { key: "Escape" });
    document.dispatchEvent(event);

    expect(mockOnClose).toHaveBeenCalled();
  });

  it("does not call onClose for other keys", async () => {
    renderHook(() =>
      useHealthScorePanel({
        repoId: 1,
        onClose: mockOnClose,
      })
    );

    const event = new KeyboardEvent("keydown", { key: "Enter" });
    document.dispatchEvent(event);

    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("works without onRecalculate callback", async () => {
    vi.mocked(apiClient.calculateHealthScore).mockResolvedValue(mockHealthScoreResponse);

    const { result } = renderHook(() =>
      useHealthScorePanel({
        repoId: 1,
        onClose: mockOnClose,
      })
    );

    await act(async () => {
      await result.current.handleRecalculate();
    });

    expect(apiClient.calculateHealthScore).toHaveBeenCalledWith(1);
    expect(result.current.recalculating).toBe(false);
  });
});
