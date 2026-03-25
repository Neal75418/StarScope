/**
 * GitHub starred repos 匯入的管理 hook。
 */

import { useState, useCallback, useMemo, useRef } from "react";
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
  const importRequestIdRef = useRef(0);

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
    setResult(null);
    setSelectedRepos(new Set());
    if (fetchEnabled) {
      // 已啟用過 — 直接 refetch 以支援重複觸發
      void refetch();
    } else {
      // 首次啟用 — React Query 會在 enabled 變 true 後自動 fetch
      setFetchEnabled(true);
    }
  }, [fetchEnabled, refetch]);

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

    const requestId = ++importRequestIdRef.current;
    setIsImporting(true);
    setImportError(null);
    try {
      const repos: RepoCreate[] = [...selectedRepos].map((fullName) => {
        const [owner, name] = fullName.split("/");
        return { owner, name };
      });

      const importResult = await batchAddRepos(repos);
      if (requestId !== importRequestIdRef.current) return; // 已被 reset 取代
      setResult(importResult);

      // 匯入成功後重新取得 repos 清單
      void queryClient.invalidateQueries({ queryKey: queryKeys.repos.all });
    } catch (err) {
      if (requestId !== importRequestIdRef.current) return;
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      if (requestId === importRequestIdRef.current) {
        setIsImporting(false);
      }
    }
  }, [selectedRepos, queryClient]);

  const reset = useCallback(() => {
    importRequestIdRef.current++; // 使飛行中的請求被忽略
    setFetchEnabled(false);
    setSelectedRepos(new Set());
    setResult(null);
    setImportError(null);
    setIsImporting(false);
    // 清除快取，避免重新開啟時閃現舊資料
    queryClient.removeQueries({ queryKey: queryKeys.repos.starred() });
  }, [queryClient]);

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
