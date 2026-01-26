import { useState, useRef } from "react";
import { ImportResult } from "../utils/importHelpers";

export function useImportState() {
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const reset = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsImporting(true);
    setResult(null);
    return controller;
  };

  const cancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsImporting(false);
  };

  const complete = (res: ImportResult) => {
    setResult(res);
    setIsImporting(false);
    abortControllerRef.current = null;
  };

  return {
    isImporting,
    result,
    setResult,
    reset,
    cancel,
    complete,
    abortControllerRef,
  };
}
