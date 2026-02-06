/**
 * 分類篩選與搜尋管理。
 */

import { useState, useEffect, useMemo } from "react";
import { RepoWithSignals, getCategoryRepos } from "../api/client";

/**
 * 檢查 repo 是否符合搜尋關鍵字（搜尋範圍：full_name、description、language）。
 */
function matchesSearch(repo: RepoWithSignals, query: string): boolean {
  const lowerQuery = query.toLowerCase();
  return (
    repo.full_name.toLowerCase().includes(lowerQuery) ||
    (repo.description?.toLowerCase().includes(lowerQuery) ?? false) ||
    (repo.language?.toLowerCase().includes(lowerQuery) ?? false)
  );
}

export function useCategoryFilter(repos: RepoWithSignals[]) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [filteredRepoIds, setFilteredRepoIds] = useState<Set<number> | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");

  // 搜尋防抖，避免每次按鍵都觸發篩選
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

    // 記錄請求時的分類 ID，防止 race condition
    const requestedCategoryId = selectedCategoryId;

    getCategoryRepos(selectedCategoryId)
      .then((response) => {
        // 僅在分類未於請求期間切換時更新狀態
        if (requestedCategoryId === selectedCategoryId) {
          setFilteredRepoIds(new Set(response.repos.map((r) => r.id)));
        }
      })
      .catch((err) => {
        // 僅在分類未於請求期間切換時更新狀態
        if (requestedCategoryId === selectedCategoryId) {
          console.error("分類 Repo 載入失敗:", err);
          setFilteredRepoIds(null);
        }
      });
  }, [selectedCategoryId]);

  const displayedRepos = useMemo(() => {
    let result = repos;

    // 套用分類篩選
    if (filteredRepoIds) {
      result = result.filter((r) => filteredRepoIds.has(r.id));
    }

    // 套用搜尋篩選（使用防抖值提升效能）
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
