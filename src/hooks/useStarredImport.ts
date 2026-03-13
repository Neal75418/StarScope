/**
 * GitHub starred repos 匯入的管理 hook。
 */

import { useState, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getStarredRepos, batchAddRepos } from "../api/client";
import { queryKeys } from "../lib/react-query";
import type { RepoCreate, BatchImportResult } from "../api/types";

export function useStarredImport() {
  const queryClient = useQueryClient();
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<BatchImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [fetchEnabled, setFetchEnabled] = useState(false);

  const {
    data: starredData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.repos.starred(),
    queryFn: ({ signal }) => getStarredRepos(signal),
    enabled: fetchEnabled,
  });

  const starredRepos = useMemo(() => starredData?.repos ?? [], [starredData]);

  const fetchStarred = useCallback(() => {
    setFetchEnabled(true);
    setResult(null);
    setSelectedRepos(new Set());
    void refetch();
  }, [refetch]);

  const toggleRepo = useCallback((fullName: string) => {
    setSelectedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(fullName)) {
        next.delete(fullName);
      } else {
        next.add(fullName);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedRepos(new Set(starredRepos.map((r) => r.full_name)));
  }, [starredRepos]);

  const deselectAll = useCallback(() => {
    setSelectedRepos(new Set());
  }, []);

  const startImport = useCallback(async () => {
    if (selectedRepos.size === 0) return;

    setIsImporting(true);
    setImportError(null);
    try {
      const repos: RepoCreate[] = [...selectedRepos].map((fullName) => {
        const [owner, name] = fullName.split("/");
        return { owner, name };
      });

      const importResult = await batchAddRepos(repos);
      setResult(importResult);

      // 匯入成功後重新取得 repos 清單
      void queryClient.invalidateQueries({ queryKey: queryKeys.repos.all });
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsImporting(false);
    }
  }, [selectedRepos, queryClient]);

  const reset = useCallback(() => {
    setFetchEnabled(false);
    setSelectedRepos(new Set());
    setResult(null);
    setImportError(null);
  }, []);

  return {
    starredRepos,
    isLoading,
    error: error ? String(error) : null,
    fetchStarred,
    selectedRepos,
    toggleRepo,
    selectAll,
    deselectAll,
    startImport,
    isImporting,
    result,
    importError,
    reset,
    hasFetched: fetchEnabled,
  };
}
