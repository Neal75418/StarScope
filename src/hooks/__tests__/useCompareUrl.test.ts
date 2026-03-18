import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCompareUrl, _serializeToHash, _deserializeFromHash } from "../useCompareUrl";

describe("_serializeToHash", () => {
  it("returns empty string for default state", () => {
    expect(
      _serializeToHash({
        repoIds: [],
        timeRange: "30d",
        normalize: false,
        metric: "stars",
        chartType: "line",
        logScale: false,
        showGrowthRate: false,
      })
    ).toBe("");
  });

  it("includes repos when set", () => {
    const hash = _serializeToHash({
      repoIds: [1, 2, 3],
      timeRange: "30d",
      normalize: false,
      metric: "stars",
      chartType: "line",
      logScale: false,
      showGrowthRate: false,
    });
    expect(hash).toBe("#c:repos=1%2C2%2C3");
  });

  it("includes range when not 30d", () => {
    const hash = _serializeToHash({
      repoIds: [],
      timeRange: "90d",
      normalize: false,
      metric: "stars",
      chartType: "line",
      logScale: false,
      showGrowthRate: false,
    });
    expect(hash).toBe("#c:range=90d");
  });

  it("includes norm when true", () => {
    const hash = _serializeToHash({
      repoIds: [],
      timeRange: "30d",
      normalize: true,
      metric: "stars",
      chartType: "line",
      logScale: false,
      showGrowthRate: false,
    });
    expect(hash).toBe("#c:norm=1");
  });

  it("includes metric when not stars", () => {
    const hash = _serializeToHash({
      repoIds: [],
      timeRange: "30d",
      normalize: false,
      metric: "forks",
      chartType: "line",
      logScale: false,
      showGrowthRate: false,
    });
    expect(hash).toBe("#c:metric=forks");
  });

  it("includes chart when not line", () => {
    const hash = _serializeToHash({
      repoIds: [],
      timeRange: "30d",
      normalize: false,
      metric: "stars",
      chartType: "area",
      logScale: false,
      showGrowthRate: false,
    });
    expect(hash).toBe("#c:chart=area");
  });

  it("includes all params", () => {
    const hash = _serializeToHash({
      repoIds: [1, 2],
      timeRange: "7d",
      normalize: true,
      metric: "forks",
      chartType: "area",
      logScale: false,
      showGrowthRate: false,
    });
    expect(hash).toMatch(/^#c:/);
    expect(hash).toContain("repos=1%2C2");
    expect(hash).toContain("range=7d");
    expect(hash).toContain("norm=1");
    expect(hash).toContain("metric=forks");
    expect(hash).toContain("chart=area");
  });
});

describe("_deserializeFromHash", () => {
  it("returns null for empty hash", () => {
    expect(_deserializeFromHash("")).toBeNull();
  });

  it("returns null for non-compare hash", () => {
    expect(_deserializeFromHash("#t:sort=velocity")).toBeNull();
  });

  it("returns null for empty compare hash", () => {
    expect(_deserializeFromHash("#c:")).toBeNull();
  });

  it("parses repos parameter", () => {
    const state = _deserializeFromHash("#c:repos=1%2C2%2C3");
    expect(state?.repoIds).toEqual([1, 2, 3]);
  });

  it("parses range parameter", () => {
    const state = _deserializeFromHash("#c:range=90d");
    expect(state?.timeRange).toBe("90d");
  });

  it("parses norm parameter", () => {
    const state = _deserializeFromHash("#c:norm=1");
    expect(state?.normalize).toBe(true);
  });

  it("parses metric parameter", () => {
    const state = _deserializeFromHash("#c:metric=forks");
    expect(state?.metric).toBe("forks");
  });

  it("parses chart parameter", () => {
    const state = _deserializeFromHash("#c:chart=area");
    expect(state?.chartType).toBe("area");
  });

  it("defaults invalid range to 30d", () => {
    const state = _deserializeFromHash("#c:range=invalid");
    expect(state?.timeRange).toBe("30d");
  });

  it("defaults invalid metric to stars", () => {
    const state = _deserializeFromHash("#c:metric=invalid");
    expect(state?.metric).toBe("stars");
  });

  it("defaults invalid chart type to line", () => {
    const state = _deserializeFromHash("#c:chart=invalid");
    expect(state?.chartType).toBe("line");
  });

  it("filters out invalid repo ids", () => {
    const state = _deserializeFromHash("#c:repos=1%2Cabc%2C3");
    expect(state?.repoIds).toEqual([1, 3]);
  });

  it("parses all params together", () => {
    const state = _deserializeFromHash("#c:repos=1%2C2&range=7d&norm=1&metric=forks&chart=area");
    expect(state).toEqual({
      repoIds: [1, 2],
      timeRange: "7d",
      normalize: true,
      metric: "forks",
      chartType: "area",
      logScale: false,
      showGrowthRate: false,
    });
  });
});

describe("useCompareUrl", () => {
  let originalHash: string;

  beforeEach(() => {
    originalHash = window.location.hash;
    window.history.replaceState(null, "", window.location.pathname);
  });

  afterEach(() => {
    window.history.replaceState(null, "", originalHash || window.location.pathname);
  });

  it("restores state from URL hash on mount", () => {
    window.history.replaceState(null, "", "#c:repos=1%2C2&range=7d&norm=1&metric=forks&chart=area");
    const onRestoreState = vi.fn();

    renderHook(() =>
      useCompareUrl({
        repoIds: [],
        timeRange: "30d",
        normalize: false,
        metric: "stars",
        chartType: "line",
        logScale: false,
        showGrowthRate: false,
        onRestoreState,
      })
    );

    expect(onRestoreState).toHaveBeenCalledWith({
      repoIds: [1, 2],
      timeRange: "7d",
      normalize: true,
      metric: "forks",
      chartType: "area",
      logScale: false,
      showGrowthRate: false,
    });
  });

  it("does not call onRestoreState when no hash params", () => {
    const onRestoreState = vi.fn();
    renderHook(() =>
      useCompareUrl({
        repoIds: [],
        timeRange: "30d",
        normalize: false,
        metric: "stars",
        chartType: "line",
        logScale: false,
        showGrowthRate: false,
        onRestoreState,
      })
    );
    expect(onRestoreState).not.toHaveBeenCalled();
  });

  it("updates URL hash when state changes", () => {
    const onRestoreState = vi.fn();
    type HookProps = Omit<Parameters<typeof useCompareUrl>[0], "onRestoreState">;
    const { rerender } = renderHook(
      (props: HookProps) => useCompareUrl({ ...props, onRestoreState }),
      {
        initialProps: {
          repoIds: [],
          timeRange: "30d",
          normalize: false,
          metric: "stars",
          chartType: "line",
          logScale: false,
          showGrowthRate: false,
        } as HookProps,
      }
    );

    rerender({
      repoIds: [1, 2],
      timeRange: "30d",
      normalize: false,
      metric: "stars",
      chartType: "line",
      logScale: false,
      showGrowthRate: false,
    } as HookProps);
    expect(window.location.hash).toContain("repos=1%2C2");
  });

  it("clears hash when state returns to defaults", async () => {
    window.history.replaceState(null, "", "#c:range=90d");
    const onRestoreState = vi.fn();
    type HookProps = Omit<Parameters<typeof useCompareUrl>[0], "onRestoreState">;
    const { rerender } = renderHook(
      (props: HookProps) => useCompareUrl({ ...props, onRestoreState }),
      {
        initialProps: {
          repoIds: [],
          timeRange: "90d",
          normalize: false,
          metric: "stars",
          chartType: "line",
          logScale: false,
          showGrowthRate: false,
        } as HookProps,
      }
    );

    // 等待 queueMicrotask 重置 isSyncingRef
    await act(async () => {});

    rerender({
      repoIds: [],
      timeRange: "30d",
      normalize: false,
      metric: "stars",
      chartType: "line",
      logScale: false,
      showGrowthRate: false,
    } as HookProps);
    expect(window.location.hash).toBe("");
  });

  it("returns hasUrlParams true when hash has compare params", () => {
    window.history.replaceState(null, "", "#c:range=90d");
    const onRestoreState = vi.fn();
    const { result } = renderHook(() =>
      useCompareUrl({
        repoIds: [],
        timeRange: "30d",
        normalize: false,
        metric: "stars",
        chartType: "line",
        logScale: false,
        showGrowthRate: false,
        onRestoreState,
      })
    );
    expect(result.current.hasUrlParams).toBe(true);
  });

  it("returns hasUrlParams false when no hash", () => {
    const onRestoreState = vi.fn();
    const { result } = renderHook(() =>
      useCompareUrl({
        repoIds: [],
        timeRange: "30d",
        normalize: false,
        metric: "stars",
        chartType: "line",
        logScale: false,
        showGrowthRate: false,
        onRestoreState,
      })
    );
    expect(result.current.hasUrlParams).toBe(false);
  });
});
