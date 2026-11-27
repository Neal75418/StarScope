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
import { logger } from "../utils/logger";

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

      let content: string;
      try {
        content = await file.text();
      } catch (err) {
        // 讀檔錯誤是瀏覽器的英文訊息（例如 NotReadableError），不上畫面
        logger.warn("[Import] 讀不到檔案:", err);
        setParseError(t.settings.import.readFailed);
        return;
      }

      try {
        const repos = parseRepositories(content, file.name);

        if (repos.length === 0) {
          setParseError(t.settings.import.noValidRepos);
          return;
        }

        setParsedRepos(removeDuplicates(repos));
      } catch (err) {
        // 解析器自己接住格式錯誤（壞掉的 JSON 回空清單）；走到這裡是沒預期到的例外，訊息不上畫面
        logger.warn("[Import] 檔案解析失敗:", err);
        setParseError(t.settings.import.parseFailed);
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

  const reset = useCallback(() => {
    cancelImport();
    setParsedRepos([]);
    setParseError(null);
    setResult(null);
  }, [cancelImport, setResult]);

  return {
    parsedRepos,
    isImporting,
    result,
    parseError,
    parseFile,
    parseText,
    startImport,
    reset,
  };
}
