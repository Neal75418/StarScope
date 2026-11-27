/**
 * Star 歷史回填操作。
 */

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { backfillStarHistory } from "../api/client";
import type { BackfillResult } from "../api/client";
import { interpolate, useI18n } from "../i18n";
import type { TranslationKeys } from "../i18n";
import { keepRefetchingAfterTimeout, queryKeys } from "../lib/react-query";
import { getBackfillErrorMessage } from "../utils/backfillErrorHelper";
import { MAX_STARS_FOR_BACKFILL } from "../utils/backfillHelpers";
import { logger } from "../utils/logger";
import { isRequestTimeout } from "../utils/writeFailure";

/** 後端拒絕回填（success=false）時的說明：只認得的 code 有自己的說法，其餘說沒有回填、請再試一次 */
function describeRefusal(result: BackfillResult, t: TranslationKeys): string {
  if (result.code === "TOO_MANY_STARS") {
    return interpolate(t.starHistory.backfillTooManyStars, { count: MAX_STARS_FOR_BACKFILL });
  }
  return interpolate(t.failure.withCause, {
    outcome: t.starHistory.backfillFailure.notDone,
    cause: t.failure.retry,
  });
}

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
  const queryClient = useQueryClient();
  const [backfilling, setBackfilling] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  // 等不到回應時的說明：不確定不是失敗，用警告顯示，不走 setError（紅字＋role=alert）
  const [warningMessage, setWarningMessage] = useState<string | null>(null);

  const handleBackfill = useCallback(async () => {
    setWarningMessage(null);
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
        // 回填完成後重新載入狀態（失敗不應歸因於回填本身）
        try {
          await onSuccess();
        } catch (refreshErr) {
          logger.warn("[BackfillAction] 回填成功但刷新失敗:", refreshErr);
        }
        onComplete?.();
      } else {
        // 後端確定沒有寫入（拒絕回填），不用重讀；message 是英文內部用語，不上畫面
        setError(describeRefusal(result, t));
      }
    } catch (err) {
      logger.error("[BackfillAction] 回填失敗:", err);
      const message = getBackfillErrorMessage(err, t);
      if (isRequestTimeout(err)) setWarningMessage(message);
      else setError(message);
      // 失敗也可能已經寫了：重讀這個 repo 的圖表，逾時時伺服器多半還在做，接下來一陣子定期重讀。
      // 走 queryClient（元件卸載後仍有效）；不重讀回填狀態：錯誤的說明放在 useBackfillStatus 的 manualError，
      // 狀態讀回成功就會清掉（逾時的警告是這裡自己的 state，不受影響）
      const reloadChart = () =>
        void queryClient.invalidateQueries({
          queryKey: queryKeys.starsChart.repo(repoId),
        });
      reloadChart();
      if (isRequestTimeout(err)) keepRefetchingAfterTimeout(reloadChart);
    } finally {
      setBackfilling(false);
    }
  }, [repoId, isOffline, t, onSuccess, onComplete, setError, queryClient]);

  return {
    backfilling,
    successMessage,
    warningMessage,
    handleBackfill,
  };
}
