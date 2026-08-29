/**
 * 匯入流程執行器，協調解析與批次匯入。
 */

import { useCallback, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { ParsedRepo } from "../utils/importHelpers";
import { executeImportFlow } from "../utils/importExecutorHelpers";
import { useImportState } from "./useImportState";
import { useWatchlistActions } from "../contexts/WatchlistContext";

interface UseImportExecutorOptions {
  parsedRepos: ParsedRepo[];
  setParsedRepos: Dispatch<SetStateAction<ParsedRepo[]>>;
}

export function useImportExecutor({ parsedRepos, setParsedRepos }: UseImportExecutorOptions) {
  const { isImporting, result, setResult, reset, cancel, complete } = useImportState();
  const { invalidateRepos } = useWatchlistActions();

  // 依 fullName 更新特定 repo 狀態
  const updateRepo = useCallback(
    (fullName: string, updates: Partial<ParsedRepo>) => {
      setParsedRepos((prev) =>
        prev.map((r) => (r.fullName === fullName ? { ...r, ...updates } : r))
      );
    },
    [setParsedRepos]
  );

  const startImport = useCallback(async () => {
    if (parsedRepos.length === 0 || isImporting) return;

    const controller = reset();

    // 執行完整匯入流程
    const outcome = await executeImportFlow(parsedRepos, controller, updateRepo);

    // repos query 掛在 app 層永不卸載且 refetchOnWindowFocus 關閉，
    // 不主動 invalidate 的話，匯入的 repo 要等 staleTime 過期才會出現在清單。
    // 取消也要做：取消前已成功的那些一樣進了後端。
    if (outcome.success > 0) {
      invalidateRepos();
    }

    if (!controller.signal.aborted) {
      complete({
        total: parsedRepos.length,
        ...outcome,
      });
    }
  }, [parsedRepos, isImporting, reset, complete, updateRepo, invalidateRepos]);

  useEffect(() => {
    return () => cancel();
  }, [cancel]);

  return {
    isImporting,
    result,
    setResult,
    startImport,
    cancelImport: cancel,
  };
}
