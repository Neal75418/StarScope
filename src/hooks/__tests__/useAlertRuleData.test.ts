import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("../../api/client", () => ({
  listAlertRules: vi.fn(),
  listSignalTypes: vi.fn(),
  getRepos: vi.fn(),
}));

vi.mock("../../utils/error", () => ({
  getErrorMessage: (err: unknown, fallback: string) =>
    err instanceof Error ? err.message : fallback,
}));

import { listAlertRules, listSignalTypes, getRepos } from "../../api/client";
import { useAlertRuleData } from "../useAlertRuleData";
import type { Toast } from "../types";

const mockListAlertRules = vi.mocked(listAlertRules);
const mockListSignalTypes = vi.mocked(listSignalTypes);
const mockGetRepos = vi.mocked(getRepos);

describe("useAlertRuleData", () => {
  let mockToast: Toast;

  beforeEach(() => {
    vi.clearAllMocks();
    mockToast = { success: vi.fn(), error: vi.fn() };
  });

  it("loads all three data sources on mount", async () => {
    const rules = [{ id: 1, name: "Rule 1" }];
    const signalTypes = [{ name: "stars_velocity", label: "Stars Velocity" }];
    const repos = [{ id: 1, full_name: "test/repo" }];

    mockListAlertRules.mockResolvedValue(rules as never);
    mockListSignalTypes.mockResolvedValue(signalTypes as never);
    mockGetRepos.mockResolvedValue({ repos } as never);

    const { result } = renderHook(() => useAlertRuleData(mockToast));

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.rules).toEqual(rules);
    expect(result.current.signalTypes).toEqual(signalTypes);
    expect(result.current.repos).toEqual(repos);
  });

  it("shows error toast when listAlertRules fails", async () => {
    mockListAlertRules.mockRejectedValue(new Error("Rules failed"));
    mockListSignalTypes.mockResolvedValue([]);
    mockGetRepos.mockResolvedValue({ repos: [] } as never);

    const { result } = renderHook(() => useAlertRuleData(mockToast));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockToast.error).toHaveBeenCalledWith("Rules failed");
  });

  it("shows error toast when listSignalTypes fails", async () => {
    mockListAlertRules.mockResolvedValue([]);
    mockListSignalTypes.mockRejectedValue(new Error("Signals failed"));
    mockGetRepos.mockResolvedValue({ repos: [] } as never);

    const { result } = renderHook(() => useAlertRuleData(mockToast));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockToast.error).toHaveBeenCalledWith("Signals failed");
  });

  it("shows error toast when getRepos fails", async () => {
    mockListAlertRules.mockResolvedValue([]);
    mockListSignalTypes.mockResolvedValue([]);
    mockGetRepos.mockRejectedValue(new Error("Repos failed"));

    const { result } = renderHook(() => useAlertRuleData(mockToast));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockToast.error).toHaveBeenCalledWith("Repos failed");
  });

  it("finishes loading even when all APIs fail", async () => {
    mockListAlertRules.mockRejectedValue(new Error("fail"));
    mockListSignalTypes.mockRejectedValue(new Error("fail"));
    mockGetRepos.mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() => useAlertRuleData(mockToast));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // toast.error called 3 times (once for each failed API)
    expect(mockToast.error).toHaveBeenCalledTimes(3);
  });

  it("exposes loadRules for manual refresh", async () => {
    mockListAlertRules.mockResolvedValue([]);
    mockListSignalTypes.mockResolvedValue([]);
    mockGetRepos.mockResolvedValue({ repos: [] } as never);

    const { result } = renderHook(() => useAlertRuleData(mockToast));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const newRules = [{ id: 2, name: "New Rule" }];
    mockListAlertRules.mockResolvedValue(newRules as never);

    await act(async () => {
      await result.current.loadRules();
    });

    expect(result.current.rules).toEqual(newRules);
  });
});
