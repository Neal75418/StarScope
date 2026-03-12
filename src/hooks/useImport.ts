/**
 * Repository 匯入：解析檔案 / 文字並執行匯入。
 */

import { useState, useCallback } from "react";
import { parseRepositories, removeDuplicates } from "../utils/importHelpers";
import type { ParsedRepo } from "../utils/importHelpers";

// 重新匯出型別供外部使用
export type { ParsedRepo, ImportResult } from "../utils/importHelpers";
import { useImportExecutor } from "./useImportExecutor";
import { useI18n } from "../i18n";

export function useImport() {
  const { t } = useI18n();
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
          setParseError(t.settings.import.noValidRepos);
          return;
        }

        setParsedRepos(removeDuplicates(repos));
      } catch (err) {
        setParseError(err instanceof Error ? err.message : t.settings.import.parseFailed);
      }
    },
    [setResult, t]
  );

  const parseText = useCallback(
    (text: string) => {
      setParseError(null);
      setResult(null);
      setParsedRepos([]);

      const repos = parseRepositories(text);

      if (repos.length === 0) {
        setParseError(t.settings.import.noValidReposText);
        return;
      }

      setParsedRepos(removeDuplicates(repos));
    },
    [setResult, t]
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
