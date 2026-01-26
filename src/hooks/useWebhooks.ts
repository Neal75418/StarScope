/**
 * Hook for managing webhooks state and operations.
 * Composes useDeleteConfirm and useWebhookOperations for reduced complexity.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Webhook, WebhookCreate, WebhookLog, listWebhooks, getWebhook } from "../api/client";
import { getErrorMessage } from "../utils/error";
import { useI18n } from "../i18n";
import { useDeleteConfirm } from "./useDeleteConfirm";
import { useWebhookOperations } from "./useWebhookOperations";

const initialWebhook: WebhookCreate = {
  name: "",
  webhook_type: "slack",
  url: "",
  triggers: ["signal_detected"],
};

interface Toast {
  success: (msg: string) => void;
  error: (msg: string) => void;
}

export function useWebhooks(toast: Toast) {
  const { t } = useI18n();
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [editingWebhook, setEditingWebhook] = useState<Webhook | null>(null);
  const [viewingLogsId, setViewingLogsId] = useState<number | null>(null);
  const [webhookLogs, setWebhookLogs] = useState<WebhookLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  const deleteConfirm = useDeleteConfirm();

  // Prevent duplicate fetches from StrictMode
  const hasFetchedRef = useRef(false);

  const loadWebhooks = useCallback(async () => {
    try {
      const response = await listWebhooks();
      setWebhooks(response.webhooks);
    } catch (err) {
      toast.error(getErrorMessage(err, t.settings.webhooks.toast.testFailed));
    }
  }, [toast, t]);

  useEffect(() => {
    // Skip if already fetched (prevents StrictMode double-fetch)
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    setIsLoading(true);
    loadWebhooks().finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const operations = useWebhookOperations({ toast, onSuccess: loadWebhooks });

  const handleCreate = useCallback(
    async (webhook: WebhookCreate): Promise<boolean> => {
      setIsSubmitting(true);
      try {
        return await operations.handleCreate(webhook);
      } finally {
        setIsSubmitting(false);
      }
    },
    [operations]
  );

  const handleUpdate = useCallback(
    async (webhook: WebhookCreate): Promise<boolean> => {
      if (!editingWebhook) return false;
      setIsSubmitting(true);
      try {
        const success = await operations.handleUpdate(editingWebhook.id, webhook);
        if (success) {
          setEditingWebhook(null);
        }
        return success;
      } finally {
        setIsSubmitting(false);
      }
    },
    [editingWebhook, operations]
  );

  const handleTest = useCallback(
    async (id: number) => {
      setTestingId(id);
      try {
        await operations.handleTest(id);
      } finally {
        setTestingId(null);
      }
    },
    [operations]
  );

  const handleEdit = useCallback(
    async (webhook: Webhook) => {
      // Fetch fresh webhook data to ensure we have the latest
      try {
        const freshWebhook = await getWebhook(webhook.id);
        setEditingWebhook(freshWebhook);
      } catch (err) {
        // Fallback to the passed webhook if fetch fails
        console.error("Failed to fetch webhook, using cached data:", err);
        setEditingWebhook(webhook);
      }
    },
    []
  );

  const handleCancelEdit = useCallback(() => {
    setEditingWebhook(null);
  }, []);

  const handleViewLogs = useCallback(
    async (id: number) => {
      setViewingLogsId(id);
      setIsLoadingLogs(true);
      try {
        const logs = await operations.handleGetLogs(id);
        setWebhookLogs(logs);
      } finally {
        setIsLoadingLogs(false);
      }
    },
    [operations]
  );

  const handleCloseLogs = useCallback(() => {
    setViewingLogsId(null);
    setWebhookLogs([]);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteConfirm.itemId) return;
    await operations.handleDelete(deleteConfirm.itemId);
    deleteConfirm.close();
  }, [deleteConfirm, operations]);

  // Convert Webhook to WebhookCreate for form
  const editingWebhookData: WebhookCreate | null = editingWebhook
    ? {
        name: editingWebhook.name,
        webhook_type: editingWebhook.webhook_type,
        url: editingWebhook.url,
        triggers: editingWebhook.triggers,
      }
    : null;

  return {
    webhooks,
    isLoading,
    isSubmitting,
    testingId,
    deleteConfirm: {
      isOpen: deleteConfirm.isOpen,
      webhookId: deleteConfirm.itemId,
    },
    initialWebhook,
    editingWebhook,
    editingWebhookData,
    viewingLogsId,
    webhookLogs,
    isLoadingLogs,
    handleCreate,
    handleUpdate,
    handleTest,
    handleToggle: operations.handleToggle,
    handleEdit,
    handleCancelEdit,
    handleViewLogs,
    handleCloseLogs,
    openDeleteConfirm: deleteConfirm.open,
    closeDeleteConfirm: deleteConfirm.close,
    confirmDelete,
  };
}
