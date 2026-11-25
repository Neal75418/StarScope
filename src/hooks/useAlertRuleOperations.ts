/**
 * 警報規則的 CRUD 與檢查操作。
 */

import { useCallback, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { createAlertRule, updateAlertRule, deleteAlertRule, checkAlerts } from "../api/client";
import type { AlertRule, AlertRuleCreate, AlertRuleUpdate } from "../api/client";
import { ApiError } from "../api/types";
import { useI18n } from "../i18n";
import type { TranslationKeys } from "../i18n/translations";
import { keepRefetchingAfterTimeout } from "../lib/react-query";
import { describeWriteFailure, isRequestTimeout } from "../utils/writeFailure";
import { useAsyncOperation } from "./useAsyncOperation";
import { logger } from "../utils/logger";
import type { Toast } from "./types";

/**
 * 規則已經不在清單上：刪了，或它看的儲存庫已不在追蹤清單（封存視同刪除，後端回一樣的 code）。兩種分不出來，
 * 所以不能說成已經刪除，只能說這次沒有生效、規則可能會回來。更新時表單選的儲存庫不在也回 404，但不帶這個 code：
 * 那時規則還在，存檔是真的沒成功
 */
function isAlertRuleGone(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.code === "ALERT_RULE_NOT_FOUND";
}

interface RuleWriteFailureCopy {
  notDone: string;
  timedOut: string;
  /** 建立、存檔時表單選的儲存庫不在：重試沒有用，要改選 */
  repoGone?: string;
}

/**
 * 寫入失敗時的一句話。建立、存檔遇到不帶 code 的 404 只會是選的儲存庫不在（規則不在另有 code），
 * 其餘交給 describeWriteFailure：依原因說明，後端的英文原字不上畫面
 */
function describeRuleWriteFailure(
  error: unknown,
  t: TranslationKeys,
  copy: RuleWriteFailureCopy
): string {
  const repoGone = error instanceof ApiError && error.status === 404 && error.code === null;
  if (repoGone && copy.repoGone !== undefined) return copy.repoGone;
  return describeWriteFailure(error, t, copy);
}

interface UseAlertRuleOperationsProps {
  rules: AlertRule[];
  setRules: Dispatch<SetStateAction<AlertRule[]>>;
  loadRules: () => Promise<void>;
  toast: Toast;
}

export function useAlertRuleOperations({
  rules,
  setRules,
  loadRules,
  toast,
}: UseAlertRuleOperationsProps) {
  const { t } = useI18n();
  const { isSubmitting, execute } = useAsyncOperation(toast);

  /** 寫入之後背景重讀，成功、失敗、規則已經不在都要（重讀失敗不影響寫入的結果） */
  const reloadRules = useCallback(() => {
    loadRules().catch((err) => {
      logger.warn("[AlertRules] 寫入後 reload 失敗:", err);
    });
  }, [loadRules]);

  /**
   * 失敗後重讀：失敗也可能是伺服器其實做完了。逾時的話伺服器可能還在做，接下來一陣子定期重讀，
   * 清單才會跟上做完的結果（loadRules 走 queryClient：設定頁卸載後只把清單標成過期，回到設定頁時會重抓）
   */
  const reloadAfterFailure = useCallback(
    (error: unknown) => {
      reloadRules();
      if (isRequestTimeout(error)) keepRefetchingAfterTimeout(reloadRules);
    },
    [reloadRules]
  );

  /** 逾時只是不確定有沒有做成，用警告；其餘是這一次沒做成，用錯誤 */
  const reportFailure = useCallback(
    (error: unknown, copy: RuleWriteFailureCopy) => {
      const message = describeRuleWriteFailure(error, t, copy);
      if (isRequestTimeout(error)) {
        toast.warning(message);
      } else {
        toast.error(message);
      }
    },
    [toast, t]
  );

  /**
   * 建立、改、刪一條規則。失敗時說明（逾時說不確定有沒有做成，其餘說沒做成與原因）並回 false（表單、確認框留著讓人重試）；
   * 改、刪遇到規則已經不在清單上時結束這次操作（回 true：編輯框、確認框跟著關），由 reportGone 說明。
   * 錯誤都在這裡接住，execute 只用來管送出中的狀態（它自己的失敗提示會顯示後端原字）
   */
  const writeRule = useCallback(
    async (
      write: () => Promise<unknown>,
      successMessage: string,
      failure: RuleWriteFailureCopy,
      reportGone?: () => void
    ) => {
      let gone = false;
      let failed = false;
      let failureError: unknown;
      await execute(async () => {
        try {
          await write();
          reloadRules();
        } catch (err) {
          if (reportGone !== undefined && isAlertRuleGone(err)) {
            gone = true;
            reloadRules();
          } else {
            failed = true;
            failureError = err;
            reloadAfterFailure(err);
          }
        }
      });
      if (failed) {
        reportFailure(failureError, failure);
        return false;
      }
      if (gone) {
        reportGone?.();
      } else {
        toast.success(successMessage);
      }
      return true;
    },
    [execute, reloadRules, reloadAfterFailure, reportFailure, toast]
  );

  const handleCreate = useCallback(
    async (rule: AlertRuleCreate) => {
      return writeRule(
        () => createAlertRule(rule),
        t.settings.alerts.toast.created,
        t.settings.alerts.failed.create
      );
    },
    [writeRule, t]
  );

  const handleUpdate = useCallback(
    async (id: number, rule: AlertRuleCreate) => {
      // 表單沒有的說明與儲存庫送 null：送 undefined 的話 JSON 裡沒有這個欄位，後端當成沒改，
      // 舊的說明會留著、規則還是只看原本那個儲存庫
      const update: AlertRuleUpdate = {
        name: rule.name,
        description: rule.description ?? null,
        repo_id: rule.repo_id ?? null,
        signal_type: rule.signal_type,
        operator: rule.operator,
        threshold: rule.threshold,
        enabled: rule.enabled,
      };
      // 規則不在時變更確實沒存（警告）
      return writeRule(
        () => updateAlertRule(id, update),
        t.settings.alerts.toast.updated,
        t.settings.alerts.failed.update,
        () => toast.warning(t.settings.alerts.toast.goneNotSaved)
      );
    },
    [writeRule, toast, t]
  );

  const handleDelete = useCallback(
    async (id: number) => {
      // 規則不在時可能是真的刪了、也可能只是藏起來，不說成已經刪除（說明，不警告）
      return writeRule(
        () => deleteAlertRule(id),
        t.settings.alerts.toast.deleted,
        t.settings.alerts.failed.delete,
        () => toast.info(t.settings.alerts.toast.goneOnDelete)
      );
    },
    [writeRule, toast, t]
  );

  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  // 防止同一規則被並發 toggle（快速雙擊防護）
  const togglingRef = useRef<Set<number>>(new Set());

  const handleToggle = useCallback(
    async (id: number) => {
      if (togglingRef.current.has(id)) return; // 已有 in-flight toggle
      const rule = rulesRef.current.find((r) => r.id === id);
      if (!rule) return;

      const newEnabled = !rule.enabled;
      togglingRef.current.add(id);

      // 樂觀更新 UI
      setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: newEnabled } : r)));

      try {
        await updateAlertRule(id, { enabled: newEnabled });
      } catch (err) {
        // 失敗時先還原，再重讀以伺服器為準（逾時時伺服器可能其實已經切換了）
        setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !newEnabled } : r)));
        if (isAlertRuleGone(err)) {
          toast.warning(t.settings.alerts.toast.goneNotSwitched);
          reloadRules();
        } else {
          reportFailure(err, t.settings.alerts.failed.toggle);
          reloadAfterFailure(err);
        }
      } finally {
        togglingRef.current.delete(id);
      }
    },
    [setRules, toast, t, reloadRules, reloadAfterFailure, reportFailure]
  );

  const handleCheckNow = useCallback(async () => {
    return execute(async () => {
      return checkAlerts();
    }, t.settings.alerts.toast.checkComplete);
  }, [execute, t]);

  return {
    isSubmitting,
    handleCreate,
    handleUpdate,
    handleToggle,
    handleDelete,
    handleCheckNow,
  };
}
