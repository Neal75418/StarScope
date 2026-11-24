/**
 * 警報規則的 CRUD 與檢查操作。
 */

import { useCallback, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  createAlertRule,
  updateAlertRule,
  deleteAlertRule,
  checkAlerts,
  acknowledgeAllTriggeredAlerts,
} from "../api/client";
import type { AlertRule, AlertRuleCreate, AlertRuleUpdate } from "../api/client";
import { ApiError } from "../api/types";
import { useI18n } from "../i18n";
import { getErrorMessage } from "../utils/error";
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

  /** 寫入成功、或發現規則已經不在之後背景 reload（reload 失敗不影響寫入的結果） */
  const reloadAfterMutation = useCallback(() => {
    loadRules().catch((err) => {
      logger.warn("[AlertRules] 寫入後 reload 失敗:", err);
    });
  }, [loadRules]);

  const handleCreate = useCallback(
    async (rule: AlertRuleCreate) => {
      return execute(async () => {
        await createAlertRule(rule);
        reloadAfterMutation();
      }, t.settings.alerts.toast.created);
    },
    [execute, reloadAfterMutation, t]
  );

  /**
   * 改、刪一條規則。規則已經不在清單上時結束這次操作（回 true：編輯框、確認框跟著關），由 reportGone 說明，這裡負責重讀，
   * 不顯示後端的英文原字，也不留著一個怎麼按都失敗的框
   */
  const writeRule = useCallback(
    async (write: () => Promise<unknown>, successMessage: string, reportGone: () => void) => {
      let gone = false;
      const ok = await execute(async () => {
        try {
          await write();
        } catch (err) {
          if (!isAlertRuleGone(err)) throw err;
          gone = true;
        }
        reloadAfterMutation();
      });
      if (ok) {
        if (gone) {
          reportGone();
        } else {
          toast.success(successMessage);
        }
      }
      return ok;
    },
    [execute, reloadAfterMutation, toast]
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
        // 失敗時還原
        setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !newEnabled } : r)));
        if (isAlertRuleGone(err)) {
          toast.warning(t.settings.alerts.toast.goneNotSwitched);
          reloadAfterMutation();
        } else {
          toast.error(getErrorMessage(err, t.common.error));
        }
      } finally {
        togglingRef.current.delete(id);
      }
    },
    [setRules, toast, t, reloadAfterMutation]
  );

  const handleCheckNow = useCallback(async () => {
    return execute(async () => {
      return checkAlerts();
    }, t.settings.alerts.toast.checkComplete);
  }, [execute, t]);

  const handleAcknowledgeAll = useCallback(async () => {
    return execute(async () => {
      return acknowledgeAllTriggeredAlerts();
    }, t.settings.alerts.toast.acknowledgedAll);
  }, [execute, t]);

  return {
    isSubmitting,
    handleCreate,
    handleUpdate,
    handleToggle,
    handleDelete,
    handleCheckNow,
    handleAcknowledgeAll,
  };
}
