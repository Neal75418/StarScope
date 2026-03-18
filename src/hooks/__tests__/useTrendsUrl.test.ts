import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTrendsUrl, _serializeToHash, _deserializeFromHash } from "../useTrendsUrl";
import type { SortOption } from "../useTrends";

describe("_serializeToHash", () => {
  it("returns empty string for default state", () => {
    expect(_serializeToHash({ sortBy: "velocity", language: "", minStars: null })).toBe("");
  });

  it("includes sort when not velocity", () => {
    const hash = _serializeToHash({ sortBy: "stars_delta_7d", language: "", minStars: null });
    expect(hash).toBe("#t:sort=stars_delta_7d");
  });

  it("includes lang when set", () => {
    const hash = _serializeToHash({ sortBy: "velocity", language: "Python", minStars: null });
    expect(hash).toBe("#t:lang=Python");
  });

  it("includes stars when set", () => {
    const hash = _serializeToHash({ sortBy: "velocity", language: "", minStars: 1000 });
    expect(hash).toBe("#t:stars=1000");
  });

  it("includes all params", () => {
    const hash = _serializeToHash({
      sortBy: "acceleration",
      language: "Rust",
      minStars: 5000,
    });
    expect(hash).toContain("sort=acceleration");
    expect(hash).toContain("lang=Rust");
    expect(hash).toContain("stars=5000");
    expect(hash).toMatch(/^#t:/);
  });
});

describe("_deserializeFromHash", () => {
  it("returns null for empty hash", () => {
    expect(_deserializeFromHash("")).toBeNull();
  });

  it("returns null for non-trends hash", () => {
    expect(_deserializeFromHash("#w:sort=stars")).toBeNull();
  });

  it("returns null for empty trends hash", () => {
    expect(_deserializeFromHash("#t:")).toBeNull();
  });

  it("parses sort parameter", () => {
    const state = _deserializeFromHash("#t:sort=stars_delta_30d");
    expect(state).toEqual({
      sortBy: "stars_delta_30d",
      language: "",
      minStars: null,
    });
  });

  it("parses lang parameter", () => {
    const state = _deserializeFromHash("#t:lang=JavaScript");
    expect(state).toEqual({
      sortBy: "velocity",
      language: "JavaScript",
      minStars: null,
    });
  });

  it("parses stars parameter", () => {
    const state = _deserializeFromHash("#t:stars=500");
    expect(state).toEqual({
      sortBy: "velocity",
      language: "",
      minStars: 500,
    });
  });

  it("defaults invalid sort to velocity", () => {
    const state = _deserializeFromHash("#t:sort=invalid_key");
    expect(state?.sortBy).toBe("velocity");
  });

  it("returns null for invalid stars value", () => {
    expect(_deserializeFromHash("#t:stars=abc")).toBeNull();
  });

  it("returns null for negative stars value", () => {
    expect(_deserializeFromHash("#t:stars=-100")).toBeNull();
  });

  it("parses all params together", () => {
    const state = _deserializeFromHash("#t:sort=acceleration&lang=Go&stars=10000");
    expect(state).toEqual({
      sortBy: "acceleration",
      language: "Go",
      minStars: 10000,
    });
  });
});

describe("useTrendsUrl", () => {
  let originalHash: string;

  beforeEach(() => {
    originalHash = window.location.hash;
    window.history.replaceState(null, "", window.location.pathname);
  });

  afterEach(() => {
    window.history.replaceState(null, "", originalHash || window.location.pathname);
  });

  it("restores state from URL hash on mount", () => {
    window.history.replaceState(null, "", "#t:sort=acceleration&lang=Rust&stars=5000");
    const onRestoreState = vi.fn();

    renderHook(() =>
      useTrendsUrl({
        sortBy: "velocity",
        language: "",
        minStars: null,
        onRestoreState,
      })
    );

    expect(onRestoreState).toHaveBeenCalledWith({
      sortBy: "acceleration",
      language: "Rust",
      minStars: 5000,
    });
  });

  it("does not call onRestoreState when no hash params", () => {
    const onRestoreState = vi.fn();
    renderHook(() =>
      useTrendsUrl({
        sortBy: "velocity",
        language: "",
        minStars: null,
        onRestoreState,
      })
    );
    expect(onRestoreState).not.toHaveBeenCalled();
  });

  it("updates URL hash when state changes", () => {
    const onRestoreState = vi.fn();
    const { rerender } = renderHook(
      ({ sortBy, language, minStars }) =>
        useTrendsUrl({ sortBy, language, minStars, onRestoreState }),
      {
        initialProps: {
          sortBy: "velocity" as SortOption,
          language: "",
          minStars: null as number | null,
        },
      }
    );

    rerender({ sortBy: "stars_delta_7d", language: "", minStars: null });
    expect(window.location.hash).toBe("#t:sort=stars_delta_7d");
  });

  it("clears hash when state returns to defaults", async () => {
    window.history.replaceState(null, "", "#t:sort=acceleration");
    const onRestoreState = vi.fn();
    const { rerender } = renderHook(
      ({ sortBy, language, minStars }) =>
        useTrendsUrl({ sortBy, language, minStars, onRestoreState }),
      {
        initialProps: {
          sortBy: "acceleration" as SortOption,
          language: "",
          minStars: null as number | null,
        },
      }
    );

    // 等待 queueMicrotask 重置 isSyncingRef
    await act(async () => {});

    rerender({ sortBy: "velocity", language: "", minStars: null });
    expect(window.location.hash).toBe("");
  });

  it("returns hasUrlParams true when hash has trends params", () => {
    window.history.replaceState(null, "", "#t:sort=velocity&lang=Go");
    const onRestoreState = vi.fn();
    const { result } = renderHook(() =>
      useTrendsUrl({
        sortBy: "velocity",
        language: "",
        minStars: null,
        onRestoreState,
      })
    );
    expect(result.current.hasUrlParams).toBe(true);
  });

  it("returns hasUrlParams false when no hash", () => {
    const onRestoreState = vi.fn();
    const { result } = renderHook(() =>
      useTrendsUrl({
        sortBy: "velocity",
        language: "",
        minStars: null,
        onRestoreState,
      })
    );
    expect(result.current.hasUrlParams).toBe(false);
  });
});
