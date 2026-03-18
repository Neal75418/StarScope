import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "../../lib/react-query";
import { useTrendEarlySignals } from "../useTrendEarlySignals";

const mockSignalsResponse: Record<
  string,
  {
    signals: Array<{
      id: number;
      repo_id: number;
      repo_name: string;
      signal_type: string;
      severity: string;
      description: string;
      velocity_value: number | null;
      star_count: number | null;
      percentile_rank: number | null;
      detected_at: string;
      expires_at: string | null;
      acknowledged: boolean;
      acknowledged_at: string | null;
    }>;
    total: number;
  }
> = {
  "1": {
    signals: [
      {
        id: 100,
        repo_id: 1,
        repo_name: "foo/bar",
        signal_type: "breakout",
        severity: "high",
        description: "Breakout detected",
        velocity_value: 50,
        star_count: 1000,
        percentile_rank: 99,
        detected_at: "2024-01-01T00:00:00Z",
        expires_at: null,
        acknowledged: false,
        acknowledged_at: null,
      },
    ],
    total: 1,
  },
  "2": {
    signals: [
      {
        id: 101,
        repo_id: 2,
        repo_name: "baz/qux",
        signal_type: "rising_star",
        severity: "medium",
        description: "Rising star",
        velocity_value: 30,
        star_count: 500,
        percentile_rank: 95,
        detected_at: "2024-01-01T00:00:00Z",
        expires_at: null,
        acknowledged: true,
        acknowledged_at: "2024-01-02T00:00:00Z",
      },
    ],
    total: 1,
  },
  "3": { signals: [], total: 0 },
};

vi.mock("../../api/client", () => ({
  getRepoSignalsBatch: vi.fn(() => Promise.resolve(mockSignalsResponse)),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function createWrapper() {
  const client = createTestQueryClient();
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

describe("useTrendEarlySignals", () => {
  it("returns empty data for empty repo IDs", () => {
    const { result } = renderHook(() => useTrendEarlySignals([]), {
      wrapper: createWrapper(),
    });
    expect(result.current.signalsByRepoId).toEqual({});
    expect(result.current.reposWithBreakouts.size).toBe(0);
    expect(result.current.loading).toBe(false);
  });

  it("fetches signals and groups by repo ID", async () => {
    const { result } = renderHook(() => useTrendEarlySignals([1, 2, 3]), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Repo 1 has signals, repo 2 has signals, repo 3 has none
    expect(Object.keys(result.current.signalsByRepoId)).toHaveLength(2);
    expect(result.current.signalsByRepoId[1]).toHaveLength(1);
    expect(result.current.signalsByRepoId[2]).toHaveLength(1);
    expect(result.current.signalsByRepoId[3]).toBeUndefined();
  });

  it("identifies repos with unacknowledged signals as breakouts", async () => {
    const { result } = renderHook(() => useTrendEarlySignals([1, 2, 3]), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Repo 1 has unacknowledged signal → breakout
    expect(result.current.reposWithBreakouts.has(1)).toBe(true);
    // Repo 2 has only acknowledged signal → not a breakout
    expect(result.current.reposWithBreakouts.has(2)).toBe(false);
    // Repo 3 has no signals
    expect(result.current.reposWithBreakouts.has(3)).toBe(false);
  });

  it("stabilizes query key with sorted repo IDs", async () => {
    const { getRepoSignalsBatch } = await import("../../api/client");
    const wrapper = createWrapper();

    const { rerender } = renderHook(({ ids }) => useTrendEarlySignals(ids), {
      initialProps: { ids: [3, 1, 2] },
      wrapper,
    });

    await waitFor(() => expect(getRepoSignalsBatch).toHaveBeenCalledWith([1, 2, 3]));

    // Rerender with same IDs in different order — should not trigger a new fetch
    vi.mocked(getRepoSignalsBatch).mockClear();
    rerender({ ids: [2, 3, 1] });

    // Query key is the same (sorted), so no additional call
    expect(getRepoSignalsBatch).not.toHaveBeenCalled();
  });

  it("does not fetch when repo IDs array is empty", async () => {
    const { getRepoSignalsBatch } = await import("../../api/client");

    renderHook(() => useTrendEarlySignals([]), {
      wrapper: createWrapper(),
    });

    expect(getRepoSignalsBatch).not.toHaveBeenCalled();
  });
});
