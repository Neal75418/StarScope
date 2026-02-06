/**
 * Star 歷史回填操作。
 */

import { useState, useCallback } from "react";
import { backfillStarHistory } from "../api/client";
import { useI18n } from "../i18n";
import { getBackfillErrorMessage } from "../utils/backfillErrorHelper";

interface UseBackfillActionProps {
  repoId: number;
  isOffline: boolean;
  onSuccess: () => Promise<void>;
  onComplete?: () => void;
  setError: (msg: string | null) => void;
}

export function useBackfillAction({
  repoId,
  isOffline,
  onSuccess,
  onComplete,
  setError,
}: UseBackfillActionProps) {
  const { t } = useI18n();
  const [backfilling, setBackfilling] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleBackfill = useCallback(async () => {
    // 離線時不允許回填
    if (isOffline) {
      setError(t.starHistory.offlineNoBackfill ?? "離線狀態下無法執行回填");
      return;
    }

    try {
      setBackfilling(true);
      setError(null);
      setSuccessMessage(null);
      const result = await backfillStarHistory(repoId);
      if (result.success) {
        setSuccessMessage(
          t.starHistory.backfillComplete.replace("{count}", String(result.snapshots_created))
        );
        // 回填完成後重新載入狀態
        await onSuccess();
        onComplete?.();
      } else {
        setError(result.message);
      }
    } catch (err) {
      console.error("回填失敗:", err);
      const errorMessage = getBackfillErrorMessage(err, t);
      setError(errorMessage);
    } finally {
      setBackfilling(false);
    }
  }, [repoId, isOffline, t, onSuccess, onComplete, setError]);

  return {
    backfilling,
    successMessage,
    handleBackfill,
  };
}
