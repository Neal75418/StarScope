/**
 * Commit 活動摘要的取得。
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

  // 記憶化 config 避免不必要的 re-render
  const config = useMemo(
    () => ({
      repoId,
      failedToLoadMessage: t.commitActivity?.failedToLoad ?? "載入失敗",
      getSummary: getCommitActivitySummary,
      triggerFetch: fetchCommitActivity,
      logPrefix: "Commit 活動摘要",
    }),
    [repoId, t.commitActivity?.failedToLoad]
  );

  return useGenericSummary(config);
}
