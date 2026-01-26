import { ParsedRepo } from "../utils/importHelpers";
import { executeImportFlow } from "../utils/importExecutorHelpers";
import { useImportState } from "./useImportState";
import { useCallback, useEffect, Dispatch, SetStateAction } from "react";

interface UseImportExecutorOptions {
  parsedRepos: ParsedRepo[];
  setParsedRepos: Dispatch<SetStateAction<ParsedRepo[]>>;
}

export function useImportExecutor({ parsedRepos, setParsedRepos }: UseImportExecutorOptions) {
  const { isImporting, result, setResult, reset, cancel, complete } = useImportState();

  // Helper to update a specific repo by fullName
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

    // Orchestrate the full flow
    const outcome = await executeImportFlow(parsedRepos, controller, updateRepo);

    if (!controller.signal.aborted) {
      complete({
        total: parsedRepos.length,
        ...outcome,
      });
    }
  }, [parsedRepos, isImporting, reset, complete, updateRepo]);

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
