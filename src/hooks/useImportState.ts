/**
 * 匯入流程的狀態管理（進行中、結果、取消）。
 */

import { useState, useRef, useCallback } from "react";
import type { ImportResult } from "../utils/importHelpers";

export function useImportState() {
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsImporting(true);
    setResult(null);
    return controller;
  }, []);

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsImporting(false);
  }, []);

  const complete = useCallback((res: ImportResult) => {
    setResult(res);
    setIsImporting(false);
    abortControllerRef.current = null;
  }, []);

  return {
    isImporting,
    result,
    setResult,
    reset,
    cancel,
    complete,
  };
}
