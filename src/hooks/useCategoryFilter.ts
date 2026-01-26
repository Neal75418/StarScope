/**
 * Hook for managing category filtering.
 */

import { useState, useEffect, useMemo } from "react";
import { RepoWithSignals, getCategoryRepos } from "../api/client";

export function useCategoryFilter(repos: RepoWithSignals[]) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [filteredRepoIds, setFilteredRepoIds] = useState<Set<number> | null>(null);

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
    return filteredRepoIds ? repos.filter((r) => filteredRepoIds.has(r.id)) : repos;
  }, [repos, filteredRepoIds]);

  return {
    selectedCategoryId,
    setSelectedCategoryId,
    displayedRepos,
  };
}
