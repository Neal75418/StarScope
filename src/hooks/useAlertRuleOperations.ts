/**
 * 警報規則的 CRUD 與檢查操作。
 */

import { useCallback, Dispatch, SetStateAction } from "react";
import {
  AlertRule,
  AlertRuleCreate,
  AlertRuleUpdate,
  createAlertRule,
  updateAlertRule,
  deleteAlertRule,
  checkAlerts,
  acknowledgeAllTriggeredAlerts,
} from "../api/client";
import { useI18n } from "../i18n";
import { getErrorMessage } from "../utils/error";
import { useAsyncOperation } from "./useAsyncOperation";
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

  const handleCreate = useCallback(
    async (rule: AlertRuleCreate) => {
      return execute(async () => {
        await createAlertRule(rule);
        await loadRules();
      }, t.settings.alerts.toast.created);
    },
    [execute, loadRules, t]
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
        await loadRules();
      }, t.settings.alerts.toast.updated);
    },
    [execute, loadRules, t]
  );

  const handleDelete = useCallback(
    async (id: number) => {
      return execute(async () => {
        await deleteAlertRule(id);
        await loadRules();
      }, t.settings.alerts.toast.deleted);
    },
    [execute, loadRules, t]
  );

  const handleToggle = useCallback(
    async (id: number) => {
      const rule = rules.find((r) => r.id === id);
      if (!rule) return;

      const newEnabled = !rule.enabled;

      // 樂觀更新 UI
      setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: newEnabled } : r)));

      try {
        await updateAlertRule(id, { enabled: newEnabled });
      } catch (err) {
        // 失敗時還原
        setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !newEnabled } : r)));
        toast.error(getErrorMessage(err, t.common.error));
      }
    },
    [rules, setRules, toast, t]
  );

  const handleCheckNow = useCallback(async () => {
    return execute(async () => {
      const result = await checkAlerts();
      return result;
    }, t.settings.alerts.toast.checkComplete);
  }, [execute, t]);

  const handleAcknowledgeAll = useCallback(async () => {
    return execute(async () => {
      const result = await acknowledgeAllTriggeredAlerts();
      return result;
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
