/**
 * Hook for managing saved filter presets.
 * Uses localStorage to persist filter configurations.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { SearchFilters } from "../api/client";

export interface SavedFilter {
  id: string;
  name: string;
  createdAt: string;
  query: string;
  period?: string;
  filters: SearchFilters;
}

const STORAGE_KEY = "starscope_saved_filters";
const MAX_SAVED_FILTERS = 20;

/**
 * Generate a unique ID for a saved filter.
 */
function generateId(): string {
  return `filter-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Load saved filters from localStorage.
 */
function loadSavedFilters(): SavedFilter[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as SavedFilter[];
      // Validate and return
      if (Array.isArray(parsed)) {
        return parsed.filter((f) => f && f.id && f.name);
      }
    }
  } catch (err) {
    console.warn("Failed to load saved filters:", err);
  }
  return [];
}

/**
 * Save filters to localStorage.
 */
function saveSavedFilters(filters: SavedFilter[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch (err) {
    console.warn("Failed to save filters:", err);
  }
}

export function useSavedFilters() {
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const mountedRef = useRef(true);
  const savedFiltersRef = useRef<SavedFilter[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    const loaded = loadSavedFilters();
    if (mountedRef.current) {
      setSavedFilters(loaded);
      setIsLoaded(true);
    }

    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Save to localStorage when filters change (but not on initial load)
  useEffect(() => {
    if (isLoaded) {
      saveSavedFilters(savedFilters);
    }
    // Keep ref in sync for stale closure prevention
    savedFiltersRef.current = savedFilters;
  }, [savedFilters, isLoaded]);

  const saveFilter = useCallback(
    (
      name: string,
      query: string,
      period: string | undefined,
      filters: SearchFilters
    ): SavedFilter => {
      // Generate ID and timestamp outside setter for return value
      const id = generateId();
      const createdAt = new Date().toISOString();
      const trimmedName = name.trim();

      // Use ref to get current count for default name
      const currentCount = savedFiltersRef.current.length;
      const filterName = trimmedName || `Filter ${currentCount + 1}`;

      const newFilter: SavedFilter = {
        id,
        name: filterName,
        createdAt,
        query,
        period,
        filters,
      };

      setSavedFilters((prev) => {
        // Remove oldest if at max
        const updated = [newFilter, ...prev];
        if (updated.length > MAX_SAVED_FILTERS) {
          return updated.slice(0, MAX_SAVED_FILTERS);
        }
        return updated;
      });

      return newFilter;
    },
    []
  );

  const deleteFilter = useCallback((filterId: string) => {
    setSavedFilters((prev) => prev.filter((f) => f.id !== filterId));
  }, []);

  const renameFilter = useCallback((filterId: string, newName: string) => {
    setSavedFilters((prev) =>
      prev.map((f) => (f.id === filterId ? { ...f, name: newName.trim() || f.name } : f))
    );
  }, []);

  const clearAllFilters = useCallback(() => {
    setSavedFilters([]);
  }, []);

  const hasFilters = savedFilters.length > 0;

  return {
    savedFilters,
    saveFilter,
    deleteFilter,
    renameFilter,
    clearAllFilters,
    hasFilters,
    isLoaded,
  };
}
