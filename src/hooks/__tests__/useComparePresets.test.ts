import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useComparePresets } from "../useComparePresets";
import { STORAGE_KEYS } from "../../constants/storage";

const defaultState = {
  repoIds: [1, 2],
  timeRange: "30d" as const,
  normalize: false,
  metric: "stars" as const,
  chartType: "line" as const,
  logScale: false,
  showGrowthRate: false,
};

describe("useComparePresets", () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEYS.COMPARE_PRESETS);
  });

  it("starts with empty presets", () => {
    const { result } = renderHook(() => useComparePresets());
    expect(result.current.presets).toEqual([]);
    expect(result.current.isLoaded).toBe(true);
  });

  it("saves a preset", () => {
    const { result } = renderHook(() => useComparePresets());
    act(() => {
      result.current.savePreset("My Preset", defaultState);
    });
    expect(result.current.presets).toHaveLength(1);
    expect(result.current.presets[0].name).toBe("My Preset");
    expect(result.current.presets[0].repoIds).toEqual([1, 2]);
  });

  it("generates default name when empty", () => {
    const { result } = renderHook(() => useComparePresets());
    act(() => {
      result.current.savePreset("", defaultState);
    });
    expect(result.current.presets[0].name).toBe("Preset 1");
  });

  it("deletes a preset", () => {
    const { result } = renderHook(() => useComparePresets());
    let presetId: string;
    act(() => {
      const saved = result.current.savePreset("Test", defaultState);
      presetId = saved.id;
    });
    expect(result.current.presets).toHaveLength(1);
    act(() => {
      result.current.deletePreset(presetId);
    });
    expect(result.current.presets).toHaveLength(0);
  });

  it("persists presets to localStorage", () => {
    const { result } = renderHook(() => useComparePresets());
    act(() => {
      result.current.savePreset("Persisted", defaultState);
    });
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.COMPARE_PRESETS) ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("Persisted");
  });

  it("loads presets from localStorage on mount", () => {
    const existing = [
      {
        id: "preset_test",
        name: "Existing",
        createdAt: "2024-01-01T00:00:00Z",
        ...defaultState,
      },
    ];
    localStorage.setItem(STORAGE_KEYS.COMPARE_PRESETS, JSON.stringify(existing));

    const { result } = renderHook(() => useComparePresets());
    expect(result.current.presets).toHaveLength(1);
    expect(result.current.presets[0].name).toBe("Existing");
  });

  it("limits to 20 presets", () => {
    const { result } = renderHook(() => useComparePresets());
    act(() => {
      for (let i = 0; i < 25; i++) {
        result.current.savePreset(`Preset ${i}`, defaultState);
      }
    });
    expect(result.current.presets.length).toBeLessThanOrEqual(20);
  });
});
