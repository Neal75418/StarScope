/**
 * Compare 鍵盤快捷鍵：
 * - `n` → toggle normalize
 * - `s` → switch to stars metric
 * - `f` → switch to forks metric
 * - `i` → switch to issues metric
 * - `l` → switch to line chart
 * - `a` → switch to area chart
 * - `1`~`4` → switch time range (7d/30d/90d/all)
 * - `d` → download chart PNG
 * - `g` → toggle log scale
 * - `r` → toggle growth rate overlay
 * - `Escape` → clear search
 */

import { useEffect } from "react";
import type { ComparisonTimeRange } from "../api/types";

const TIME_RANGE_KEYS: Record<string, ComparisonTimeRange> = {
  "1": "7d",
  "2": "30d",
  "3": "90d",
  "4": "all",
};

interface UseCompareKeyboardOptions {
  onToggleNormalize: () => void;
  onSetMetric: (m: "stars" | "forks" | "issues") => void;
  onSetChartType: (t: "line" | "area") => void;
  onSetTimeRange: (tr: ComparisonTimeRange) => void;
  onDownload: () => void;
  onToggleLogScale: () => void;
  onToggleGrowthRate: () => void;
  onEscape: () => void;
  enabled?: boolean;
}

export function useCompareKeyboard({
  onToggleNormalize,
  onSetMetric,
  onSetChartType,
  onSetTimeRange,
  onDownload,
  onToggleLogScale,
  onToggleGrowthRate,
  onEscape,
  enabled = true,
}: UseCompareKeyboardOptions): void {
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const timeRange = TIME_RANGE_KEYS[e.key];
      if (timeRange) {
        e.preventDefault();
        onSetTimeRange(timeRange);
        return;
      }

      switch (e.key) {
        case "n":
          e.preventDefault();
          onToggleNormalize();
          break;
        case "s":
          e.preventDefault();
          onSetMetric("stars");
          break;
        case "f":
          e.preventDefault();
          onSetMetric("forks");
          break;
        case "i":
          e.preventDefault();
          onSetMetric("issues");
          break;
        case "l":
          e.preventDefault();
          onSetChartType("line");
          break;
        case "a":
          e.preventDefault();
          onSetChartType("area");
          break;
        case "d":
          e.preventDefault();
          onDownload();
          break;
        case "g":
          e.preventDefault();
          onToggleLogScale();
          break;
        case "r":
          e.preventDefault();
          onToggleGrowthRate();
          break;
        case "Escape":
          e.preventDefault();
          onEscape();
          break;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    onToggleNormalize,
    onSetMetric,
    onSetChartType,
    onSetTimeRange,
    onDownload,
    onToggleLogScale,
    onToggleGrowthRate,
    onEscape,
    enabled,
  ]);
}
