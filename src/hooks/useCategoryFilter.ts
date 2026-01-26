/**
 * Hook for managing category filtering and search.
 */

import { useState, useEffect, useMemo } from "react";
import { RepoWithSignals, getCategoryRepos } from "../api/client";

/**
 * Check if a repo matches the search query.
 * Searches in: full_name, description, language
 */
function matchesSearch(repo: RepoWithSignals, query: string): boolean {
  const lowerQuery = query.toLowerCase();

  // Search in full name (owner/repo)
  if (repo.full_name.toLowerCase().includes(lowerQuery)) return true;

  // Search in description
  if (repo.description?.toLowerCase().includes(lowerQuery)) return true;

  // Search in language
  if (repo.language?.toLowerCase().includes(lowerQuery)) return true;

  return false;
}

export function useCategoryFilter(repos: RepoWithSignals[]) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [filteredRepoIds, setFilteredRepoIds] = useState<Set<number> | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");

  // Debounce search query to avoid excessive filtering on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (selectedCategoryId === null) {
      setFilteredRepoIds(null);
      return;
    }

    getCategoryRepos(selectedCategoryId)
      .then((response) => {
        setFilteredRepoIds(new Set(response.repos.map((r) => r.id)));
      })
      .catch((err) => {
        console.error("Failed to load category repos:", err);
        setFilteredRepoIds(null);
      });
  }, [selectedCategoryId]);

  const displayedRepos = useMemo(() => {
    let result = repos;

    // Apply category filter
    if (filteredRepoIds) {
      result = result.filter((r) => filteredRepoIds.has(r.id));
    }

    // Apply search filter (uses debounced value for performance)
    const trimmedQuery = debouncedSearchQuery.trim();
    if (trimmedQuery) {
      result = result.filter((r) => matchesSearch(r, trimmedQuery));
    }

    return result;
  }, [repos, filteredRepoIds, debouncedSearchQuery]);

  return {
    selectedCategoryId,
    setSelectedCategoryId,
    searchQuery,
    setSearchQuery,
    displayedRepos,
  };
}
