/**
 * Compare Presets — localStorage 儲存/載入對比設定。
 * 複用 useSavedFilters 的設計模式。
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { generateId } from "../utils/id";
import { STORAGE_KEYS } from "../constants/storage";
import type { ComparisonTimeRange } from "../api/types";
import type { CompareMetric, CompareChartType } from "../pages/Compare";

export interface SavedComparePreset {
  id: string;
  name: string;
  createdAt: string;
  repoIds: number[];
  timeRange: ComparisonTimeRange;
  normalize: boolean;
  metric: CompareMetric;
  chartType: CompareChartType;
  logScale: boolean;
  showGrowthRate: boolean;
}

const MAX_PRESETS = 20;

function loadPresets(): SavedComparePreset[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.COMPARE_PRESETS);
    if (stored) {
      const parsed = JSON.parse(stored) as SavedComparePreset[];
      if (Array.isArray(parsed)) {
        return parsed.filter((p) => p && p.id && p.name);
      }
    }
  } catch {
    // ignore
  }
  return [];
}

function persistPresets(presets: SavedComparePreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.COMPARE_PRESETS, JSON.stringify(presets));
  } catch {
    // QuotaExceededError — 靜默忽略
  }
}

export function useComparePresets() {
  const [presets, setPresets] = useState<SavedComparePreset[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const presetsRef = useRef<SavedComparePreset[]>([]);

  useEffect(() => {
    const loaded = loadPresets();
    setPresets(loaded);
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (isLoaded) {
      persistPresets(presets);
    }
    presetsRef.current = presets;
  }, [presets, isLoaded]);

  const savePreset = useCallback(
    (
      name: string,
      state: Omit<SavedComparePreset, "id" | "name" | "createdAt">
    ): SavedComparePreset => {
      const id = generateId("preset");
      const createdAt = new Date().toISOString();
      const currentCount = presetsRef.current.length;
      const presetName = name.trim() || `Preset ${currentCount + 1}`;

      const newPreset: SavedComparePreset = {
        id,
        name: presetName,
        createdAt,
        ...state,
      };

      setPresets((prev) => {
        const updated = [newPreset, ...prev];
        return updated.length > MAX_PRESETS ? updated.slice(0, MAX_PRESETS) : updated;
      });

      return newPreset;
    },
    []
  );

  const deletePreset = useCallback((presetId: string) => {
    setPresets((prev) => prev.filter((p) => p.id !== presetId));
  }, []);

  return {
    presets,
    savePreset,
    deletePreset,
    isLoaded,
  };
}
