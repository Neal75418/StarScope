import { useState, useCallback } from "react";
import { parseRepositories, removeDuplicates } from "../utils/importHelpers";
import type { ParsedRepo } from "../utils/importHelpers";

// Re-export types for consumers
export type { ParsedRepo, ImportResult } from "../utils/importHelpers";
import { useImportExecutor } from "./useImportExecutor";

export function useImport() {
  const [parsedRepos, setParsedRepos] = useState<ParsedRepo[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);

  const { isImporting, result, setResult, startImport, cancelImport } = useImportExecutor({
    parsedRepos,
    setParsedRepos,
  });

  const parseFile = useCallback(
    async (file: File) => {
      setParseError(null);
      setResult(null);
      setParsedRepos([]);

      try {
        const content = await file.text();
        const repos = parseRepositories(content, file.name);

        if (repos.length === 0) {
          setParseError("No valid repositories found in file");
          return;
        }

        setParsedRepos(removeDuplicates(repos));
      } catch (err) {
        setParseError(err instanceof Error ? err.message : "Failed to parse file");
      }
    },
    [setResult]
  );

  const parseText = useCallback(
    (text: string) => {
      setParseError(null);
      setResult(null);
      setParsedRepos([]);

      const repos = parseRepositories(text);

      if (repos.length === 0) {
        setParseError("No valid repositories found");
        return;
      }

      setParsedRepos(removeDuplicates(repos));
    },
    [setResult]
  );

  return {
    parsedRepos,
    isImporting,
    result,
    parseError,
    parseFile,
    parseText,
    startImport,
    reset: cancelImport,
  };
}
