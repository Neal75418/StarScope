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
  if (result.code === "GITHUB_NOT_CONNECTED") return t.starHistory.backfillNeedsGithub;
  return interpolate(t.failure.withCause, {
    outcome: t.starHistory.backfillFailure.notDone,
    cause: t.failure.retry,
  });
}

interface UseBackfillActionProps {
  repoId: number;
  isOffline: boolean;
  onSuccess: () => Promise<void>;
}

export function useBackfillAction({ repoId, isOffline, onSuccess }: UseBackfillActionProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [backfilling, setBackfilling] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  // 回填動作自己的說明，跟讀回填狀態的說明（離線）分開：狀態讀回來不會清掉回填失敗的原因
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // 等不到回應時的說明：不確定不是失敗，用警告顯示，不走錯誤（紅字＋role=alert）
  const [warningMessage, setWarningMessage] = useState<string | null>(null);

  const handleBackfill = useCallback(async () => {
    setWarningMessage(null);
    // 離線時不允許回填
    if (isOffline) {
      setErrorMessage(t.starHistory.offlineNoBackfill);
      return;
    }

    try {
      setBackfilling(true);
      setErrorMessage(null);
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
        // 這個 repo 每個範圍的圖表都重讀（同失敗那條路）：只重讀目前這個範圍的話，
        // 切到之前看過的其他範圍（例如「全部」），5 分鐘內還是回填前的資料
        void queryClient.invalidateQueries({ queryKey: queryKeys.starsChart.repo(repoId) });
      } else {
        // 後端確定沒有寫入（拒絕回填），不用重讀；message 是英文內部用語，不上畫面
        setErrorMessage(describeRefusal(result, t));
      }
    } catch (err) {
      logger.error("[BackfillAction] 回填失敗:", err);
      const message = getBackfillErrorMessage(err, t);
      if (isRequestTimeout(err)) setWarningMessage(message);
      else setErrorMessage(message);
      // 失敗也可能已經寫了：重讀這個 repo 的圖表與回填狀態（徽章的「已有 N 天資料」），逾時時伺服器多半還在做，
      // 接下來一陣子定期重讀。走 queryClient（元件卸載後仍有效）；這裡的說明是自己的 state，狀態讀回來不會清掉它
      const reload = () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.starsChart.repo(repoId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.backfill.status(repoId) });
      };
      reload();
      if (isRequestTimeout(err)) keepRefetchingAfterTimeout(reload);
    } finally {
      setBackfilling(false);
    }
  }, [repoId, isOffline, t, onSuccess, queryClient]);

  return {
    backfilling,
    errorMessage,
    successMessage,
    warningMessage,
    handleBackfill,
  };
}
