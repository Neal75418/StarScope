/**
 * Hook for fetching languages summary.
 */

import { useMemo } from "react";
import { getLanguagesSummary, fetchLanguages, LanguagesSummary } from "../api/client";
import { useI18n } from "../i18n";
import { useGenericSummary, UseGenericSummaryResult } from "./useGenericSummary";

export function useLanguagesSummary(repoId: number): UseGenericSummaryResult<LanguagesSummary> {
  const { t } = useI18n();

  // Memoize config to prevent unnecessary re-renders
  const config = useMemo(
    () => ({
      repoId,
      failedToLoadMessage: t.languages?.failedToLoad ?? "Failed to load",
      getSummary: getLanguagesSummary,
      triggerFetch: fetchLanguages,
      logPrefix: "Languages summary",
    }),
    [repoId, t.languages?.failedToLoad]
  );

  return useGenericSummary(config);
}
