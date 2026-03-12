/**
 * 通用摘要資料取得，含 loading / error 狀態管理。
 * 使用 React Query 的 useQuery 取得資料，useMutation 觸發重新計算。
 */

import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { logger } from "../utils/logger";
import { queryKeys } from "../lib/react-query";

export interface UseGenericSummaryResult<T> {
  summary: T | null;
  loading: boolean;
  fetching: boolean;
  error: string | null;
  fetchData: () => Promise<void>;
}

interface GenericSummaryConfig<T> {
  repoId: number;
  failedToLoadMessage: string;
  getSummary: (repoId: number) => Promise<T>;
  triggerFetch: (repoId: number) => Promise<unknown>;
  logPrefix: string;
}

function isNotFoundError(err: unknown): boolean {
  return (err as { status?: number })?.status === 404;
}

export function useGenericSummary<T>(config: GenericSummaryConfig<T>): UseGenericSummaryResult<T> {
  const { repoId, failedToLoadMessage, getSummary, triggerFetch, logPrefix } = config;
  const queryClient = useQueryClient();
  const queryKey = queryKeys.summaries.generic(logPrefix, repoId);

  const query = useQuery<T | null, Error>({
    queryKey,
    queryFn: async () => {
      try {
        return await getSummary(repoId);
      } catch (err) {
        if (isNotFoundError(err)) {
          return null;
        }
        logger.error(`[${logPrefix}] 載入錯誤:`, err);
        throw err;
      }
    },
  });

  const mutation = useMutation<T | null, Error>({
    mutationFn: async () => {
      await triggerFetch(repoId);
      return getSummary(repoId);
    },
    onSuccess: (data) => {
      // 更新快取
      queryClient.setQueryData(queryKey, data);
    },
    onError: (err) => {
      logger.error(`[${logPrefix}] 取得資料錯誤:`, err);
    },
  });

  const { mutateAsync } = mutation;
  const fetchData = useCallback(async () => {
    try {
      await mutateAsync();
    } catch {
      // 錯誤已在 mutation.onError 處理
    }
  }, [mutateAsync]);

  return {
    summary: query.data ?? null,
    loading: query.isLoading,
    fetching: mutation.isPending,
    error: query.error || mutation.error ? failedToLoadMessage : null,
    fetchData,
  };
}
