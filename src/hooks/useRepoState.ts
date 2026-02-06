/**
 * Repository 列表狀態管理。
 */

import { useState } from "react";
import { RepoWithSignals } from "../api/client";

export function useRepoState() {
  const [repos, setRepos] = useState<RepoWithSignals[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadingRepoId, setLoadingRepoId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  return {
    repos,
    setRepos,
    isLoading,
    setIsLoading,
    isRefreshing,
    setIsRefreshing,
    loadingRepoId,
    setLoadingRepoId,
    error,
    setError,
  };
}
