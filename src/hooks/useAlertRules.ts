/**
 * Hook for managing alert rules state and operations.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  AlertRule,
  AlertRuleCreate,
  AlertRuleUpdate,
  SignalTypeInfo,
  listAlertRules,
  listSignalTypes,
  createAlertRule,
  updateAlertRule,
  deleteAlertRule,
  getRepos,
  RepoWithSignals,
} from "../api/client";
import { getErrorMessage } from "../utils/error";
import { useI18n } from "../i18n";
import { useDeleteConfirm } from "./useDeleteConfirm";

const initialAlertRule: AlertRuleCreate = {
  name: "",
  signal_type: "velocity",
  operator: ">",
  threshold: 10,
  enabled: true,
};

interface Toast {
  success: (msg: string) => void;
  error: (msg: string) => void;
}

export function useAlertRules(toast: Toast) {
  const { t } = useI18n();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [signalTypes, setSignalTypes] = useState<SignalTypeInfo[]>([]);
  const [repos, setRepos] = useState<RepoWithSignals[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);

  const deleteConfirm = useDeleteConfirm();

  // Prevent duplicate fetches from StrictMode
  const hasFetchedRef = useRef(false);

  const loadRules = useCallback(async () => {
    try {
      const data = await listAlertRules();
      setRules(data);
    } catch (err) {
      toast.error(getErrorMessage(err, t.common.error));
    }
  }, [toast, t]);

  const loadSignalTypes = useCallback(async () => {
    try {
      const data = await listSignalTypes();
      setSignalTypes(data);
    } catch (err) {
      toast.error(getErrorMessage(err, t.common.error));
    }
  }, [toast, t]);

  const loadRepos = useCallback(async () => {
    try {
      const response = await getRepos();
      setRepos(response.repos);
    } catch (err) {
      toast.error(getErrorMessage(err, t.common.error));
    }
  }, [toast, t]);

  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    setIsLoading(true);
    Promise.all([loadRules(), loadSignalTypes(), loadRepos()]).finally(() =>
      setIsLoading(false)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = useCallback(
    async (rule: AlertRuleCreate): Promise<boolean> => {
      setIsSubmitting(true);
      try {
        await createAlertRule(rule);
        await loadRules();
        toast.success(t.settings.alerts.toast.created);
        return true;
      } catch (err) {
        toast.error(getErrorMessage(err, t.common.error));
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [loadRules, toast, t]
  );

  const handleUpdate = useCallback(
    async (rule: AlertRuleCreate): Promise<boolean> => {
      if (!editingRule) return false;
      setIsSubmitting(true);
      try {
        const update: AlertRuleUpdate = {
          name: rule.name,
          description: rule.description,
          repo_id: rule.repo_id,
          signal_type: rule.signal_type,
          operator: rule.operator,
          threshold: rule.threshold,
          enabled: rule.enabled,
        };
        await updateAlertRule(editingRule.id, update);
        await loadRules();
        setEditingRule(null);
        toast.success(t.settings.alerts.toast.updated);
        return true;
      } catch (err) {
        toast.error(getErrorMessage(err, t.common.error));
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [editingRule, loadRules, toast, t]
  );

  const handleToggle = useCallback(
    async (id: number) => {
      const rule = rules.find((r) => r.id === id);
      if (!rule) return;

      const newEnabled = !rule.enabled;

      // Optimistic update
      setRules((prev) =>
        prev.map((r) => (r.id === id ? { ...r, enabled: newEnabled } : r))
      );

      try {
        await updateAlertRule(id, { enabled: newEnabled });
      } catch (err) {
        // Revert on failure
        setRules((prev) =>
          prev.map((r) => (r.id === id ? { ...r, enabled: !newEnabled } : r))
        );
        toast.error(getErrorMessage(err, t.common.error));
      }
    },
    [rules, toast, t]
  );

  const handleDelete = useCallback(
    async (id: number) => {
      try {
        await deleteAlertRule(id);
        await loadRules();
        toast.success(t.settings.alerts.toast.deleted);
      } catch (err) {
        toast.error(getErrorMessage(err, t.common.error));
      }
    },
    [loadRules, toast, t]
  );

  const handleEdit = useCallback((rule: AlertRule) => {
    setEditingRule(rule);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingRule(null);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteConfirm.itemId) return;
    await handleDelete(deleteConfirm.itemId);
    deleteConfirm.close();
  }, [deleteConfirm, handleDelete]);

  // Convert AlertRule to AlertRuleCreate for form
  const editingRuleData: AlertRuleCreate | null = editingRule
    ? {
        name: editingRule.name,
        description: editingRule.description ?? undefined,
        repo_id: editingRule.repo_id ?? undefined,
        signal_type: editingRule.signal_type,
        operator: editingRule.operator,
        threshold: editingRule.threshold,
        enabled: editingRule.enabled,
      }
    : null;

  return {
    rules,
    signalTypes,
    repos,
    isLoading,
    isSubmitting,
    deleteConfirm: {
      isOpen: deleteConfirm.isOpen,
      ruleId: deleteConfirm.itemId,
    },
    initialAlertRule,
    editingRule,
    editingRuleData,
    handleCreate,
    handleUpdate,
    handleToggle,
    handleEdit,
    handleCancelEdit,
    openDeleteConfirm: deleteConfirm.open,
    closeDeleteConfirm: deleteConfirm.close,
    confirmDelete,
  };
}
