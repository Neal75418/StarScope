/**
 * Hook for fetching commit activity summary.
 */

import { useMemo } from "react";
import {
  getCommitActivitySummary,
  fetchCommitActivity,
  CommitActivitySummary,
} from "../api/client";
import { useI18n } from "../i18n";
import { useGenericSummary, UseGenericSummaryResult } from "./useGenericSummary";

export function useCommitActivitySummary(
  repoId: number
): UseGenericSummaryResult<CommitActivitySummary> {
  const { t } = useI18n();

  // Memoize config to prevent unnecessary re-renders
  const config = useMemo(
    () => ({
      repoId,
      failedToLoadMessage: t.commitActivity?.failedToLoad ?? "Failed to load",
      getSummary: getCommitActivitySummary,
      triggerFetch: fetchCommitActivity,
      logPrefix: "Commit activity summary",
    }),
    [repoId, t.commitActivity?.failedToLoad]
  );

  return useGenericSummary(config);
}
