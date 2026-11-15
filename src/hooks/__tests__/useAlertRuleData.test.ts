import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "../../lib/react-query";

vi.mock("../../api/client", () => ({
  listAlertRules: vi.fn(),
  listSignalTypes: vi.fn(),
  getRepos: vi.fn(),
}));

import { listAlertRules, listSignalTypes, getRepos } from "../../api/client";
import { useAlertRuleData } from "../useAlertRuleData";

const mockListAlertRules = vi.mocked(listAlertRules);
const mockListSignalTypes = vi.mocked(listSignalTypes);
const mockGetRepos = vi.mocked(getRepos);

function createWrapper() {
  const client = createTestQueryClient();
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

describe("useAlertRuleData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads all three data sources on mount", async () => {
    const rules = [{ id: 1, name: "Rule 1" }];
    const signalTypes = [{ name: "stars_velocity", label: "Stars Velocity" }];
    const repos = [{ id: 1, full_name: "test/repo" }];

    mockListAlertRules.mockResolvedValue(rules as never);
    mockListSignalTypes.mockResolvedValue(signalTypes as never);
    mockGetRepos.mockResolvedValue({ repos } as never);

    const { result } = renderHook(() => useAlertRuleData(), { wrapper: createWrapper() });

    expect(result.current.dataLoad.ready).toBe(false);

    await waitFor(() => {
      expect(result.current.dataLoad.ready).toBe(true);
    });

    expect(result.current.rules).toEqual(rules);
    expect(result.current.signalTypes).toEqual(signalTypes);
    expect(result.current.repos).toEqual(repos);
  });

  it("reports a failed rules load, for the rule list and for the section as a whole", async () => {
    mockListAlertRules.mockRejectedValue(new Error("Rules failed"));
    mockListSignalTypes.mockResolvedValue([]);
    mockGetRepos.mockResolvedValue({ repos: [] } as never);

    const { result } = renderHook(() => useAlertRuleData(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.rulesLoad.failed).toBe(true));
    expect(result.current.rulesLoad.ready).toBe(false);
    expect(result.current.dataLoad.failed).toBe(true);
  });

  it.each([
    ["listSignalTypes", () => mockListSignalTypes.mockRejectedValue(new Error("Signals failed"))],
    ["getRepos", () => mockGetRepos.mockRejectedValue(new Error("Repos failed"))],
  ] as const)(
    "reports the section as failed, but the rule list as loaded, when %s fails",
    async (_name, failIt) => {
      mockListAlertRules.mockResolvedValue([]);
      mockListSignalTypes.mockResolvedValue([]);
      mockGetRepos.mockResolvedValue({ repos: [] } as never);
      failIt();

      const { result } = renderHook(() => useAlertRuleData(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.dataLoad.failed).toBe(true));
      await waitFor(() => expect(result.current.rulesLoad.ready).toBe(true));
      expect(result.current.rulesLoad.failed).toBe(false);
    }
  );

  it("retrying the section reloads only what failed", async () => {
    mockListAlertRules.mockResolvedValue([]);
    mockListSignalTypes.mockRejectedValueOnce(new Error("Signals failed"));
    mockListSignalTypes.mockResolvedValue([]);
    mockGetRepos.mockResolvedValue({ repos: [] } as never);
    const { result } = renderHook(() => useAlertRuleData(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.dataLoad.failed).toBe(true));

    act(() => {
      result.current.dataLoad.retry();
    });

    await waitFor(() => expect(result.current.dataLoad.failed).toBe(false));
    expect(mockListSignalTypes).toHaveBeenCalledTimes(2);
    expect(mockListAlertRules).toHaveBeenCalledTimes(1);
    expect(mockGetRepos).toHaveBeenCalledTimes(1);
  });

  it("finishes loading even when all APIs fail", async () => {
    mockListAlertRules.mockRejectedValue(new Error("fail"));
    mockListSignalTypes.mockRejectedValue(new Error("fail"));
    mockGetRepos.mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() => useAlertRuleData(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.dataLoad.failed).toBe(true);
    });
  });

  it("exposes loadRules for manual refresh", async () => {
    mockListAlertRules.mockResolvedValue([]);
    mockListSignalTypes.mockResolvedValue([]);
    mockGetRepos.mockResolvedValue({ repos: [] } as never);

    const { result } = renderHook(() => useAlertRuleData(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.dataLoad.ready).toBe(true);
    });

    const newRules = [{ id: 2, name: "New Rule" }];
    mockListAlertRules.mockResolvedValue(newRules as never);

    await act(async () => {
      await result.current.loadRules();
    });

    await waitFor(() => {
      expect(result.current.rules).toEqual(newRules);
    });
  });
});
