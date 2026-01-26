import { useState, useCallback } from "react";
import { AlertRule, AlertRuleCreate } from "../api/client";
import { useDeleteConfirm } from "./useDeleteConfirm";
import { useAlertRuleData } from "./useAlertRuleData";
import { useAlertRuleOperations } from "./useAlertRuleOperations";

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
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const deleteConfirm = useDeleteConfirm();

  const { rules, setRules, signalTypes, repos, isLoading, loadRules } = useAlertRuleData(toast);

  const {
    isSubmitting,
    handleCreate,
    handleUpdate,
    handleToggle,
    handleDelete,
    handleCheckNow,
    handleAcknowledgeAll,
  } = useAlertRuleOperations({
    rules,
    setRules,
    loadRules,
    toast,
  });

  const onUpdate = useCallback(
    async (rule: AlertRuleCreate) => {
      if (!editingRule) return false;
      const success = await handleUpdate(editingRule.id, rule);
      if (success) {
        setEditingRule(null);
      }
      return success;
    },
    [editingRule, handleUpdate]
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
    handleUpdate: onUpdate,
    handleToggle,
    handleEdit,
    handleCancelEdit,
    handleCheckNow,
    handleAcknowledgeAll,
    openDeleteConfirm: deleteConfirm.open,
    closeDeleteConfirm: deleteConfirm.close,
    confirmDelete,
  };
}
