/**
 * 程式語言摘要的取得。
 */

import { useMemo } from "react";
import { getLanguagesSummary, fetchLanguages, LanguagesSummary } from "../api/client";
import { useI18n } from "../i18n";
import { useGenericSummary, UseGenericSummaryResult } from "./useGenericSummary";

export function useLanguagesSummary(repoId: number): UseGenericSummaryResult<LanguagesSummary> {
  const { t } = useI18n();

  // 記憶化 config 避免不必要的 re-render
  const config = useMemo(
    () => ({
      repoId,
      failedToLoadMessage: t.languages?.failedToLoad ?? "載入失敗",
      getSummary: getLanguagesSummary,
      triggerFetch: fetchLanguages,
      logPrefix: "程式語言摘要",
    }),
    [repoId, t.languages?.failedToLoad]
  );

  return useGenericSummary(config);
}
