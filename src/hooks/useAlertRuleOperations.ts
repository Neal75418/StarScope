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
import { useI18n } from "../i18n";
import { getErrorMessage } from "../utils/error";
import { useAsyncOperation } from "./useAsyncOperation";
import { logger } from "../utils/logger";
import type { Toast } from "./types";

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

  /** mutation 成功後背景 reload（reload 失敗不影響 mutation 結果） */
  const reloadAfterMutation = useCallback(() => {
    loadRules().catch((err) => {
      logger.warn("[AlertRules] mutation 成功但 reload 失敗:", err);
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

  const handleUpdate = useCallback(
    async (id: number, rule: AlertRuleCreate) => {
      return execute(async () => {
        const update: AlertRuleUpdate = {
          name: rule.name,
          description: rule.description,
          repo_id: rule.repo_id,
          signal_type: rule.signal_type,
          operator: rule.operator,
          threshold: rule.threshold,
          enabled: rule.enabled,
        };
        await updateAlertRule(id, update);
        reloadAfterMutation();
      }, t.settings.alerts.toast.updated);
    },
    [execute, reloadAfterMutation, t]
  );

  const handleDelete = useCallback(
    async (id: number) => {
      return execute(async () => {
        await deleteAlertRule(id);
        reloadAfterMutation();
      }, t.settings.alerts.toast.deleted);
    },
    [execute, reloadAfterMutation, t]
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
        toast.error(getErrorMessage(err, t.common.error));
      } finally {
        togglingRef.current.delete(id);
      }
    },
    [setRules, toast, t]
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
