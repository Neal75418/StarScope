/**
 * Hook for webhook CRUD operations.
 */

import { useCallback } from "react";
import {
  WebhookCreate,
  WebhookUpdate,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  testWebhook,
  toggleWebhook,
  getWebhookLogs,
  WebhookLog,
} from "../api/client";
import { getErrorMessage } from "../utils/error";
import { useI18n } from "../i18n";

interface Toast {
  success: (msg: string) => void;
  error: (msg: string) => void;
}

interface UseWebhookOperationsOptions {
  toast: Toast;
  onSuccess: () => Promise<void>;
}

export function useWebhookOperations({ toast, onSuccess }: UseWebhookOperationsOptions) {
  const { t } = useI18n();

  const handleCreate = useCallback(
    async (webhook: WebhookCreate): Promise<boolean> => {
      try {
        await createWebhook(webhook);
        toast.success(t.settings.webhooks.toast.created);
        await onSuccess();
        return true;
      } catch (err) {
        toast.error(getErrorMessage(err, t.settings.webhooks.toast.testFailed));
        return false;
      }
    },
    [onSuccess, toast, t]
  );

  const handleUpdate = useCallback(
    async (id: number, webhook: WebhookUpdate): Promise<boolean> => {
      try {
        await updateWebhook(id, webhook);
        toast.success(t.settings.webhooks.toast.updated);
        await onSuccess();
        return true;
      } catch (err) {
        toast.error(getErrorMessage(err, t.settings.webhooks.toast.testFailed));
        return false;
      }
    },
    [onSuccess, toast, t]
  );

  const handleGetLogs = useCallback(
    async (id: number): Promise<WebhookLog[]> => {
      try {
        const response = await getWebhookLogs(id);
        return response.logs;
      } catch (err) {
        toast.error(getErrorMessage(err, t.settings.webhooks.toast.testFailed));
        return [];
      }
    },
    [toast, t]
  );

  const handleTest = useCallback(
    async (id: number): Promise<void> => {
      try {
        const result = await testWebhook(id);
        if (result.success) {
          toast.success(t.settings.webhooks.toast.testSent);
        } else {
          toast.error(t.settings.webhooks.toast.testFailed);
        }
        await onSuccess();
      } catch (err) {
        toast.error(getErrorMessage(err, t.settings.webhooks.toast.testFailed));
      }
    },
    [onSuccess, toast, t]
  );

  const handleToggle = useCallback(
    async (id: number): Promise<void> => {
      try {
        await toggleWebhook(id);
        await onSuccess();
      } catch (err) {
        toast.error(getErrorMessage(err, t.settings.webhooks.toast.testFailed));
      }
    },
    [onSuccess, toast, t]
  );

  const handleDelete = useCallback(
    async (id: number): Promise<void> => {
      try {
        await deleteWebhook(id);
        toast.success(t.settings.webhooks.toast.deleted);
        await onSuccess();
      } catch (err) {
        toast.error(getErrorMessage(err, t.settings.webhooks.toast.testFailed));
      }
    },
    [onSuccess, toast, t]
  );

  return {
    handleCreate,
    handleUpdate,
    handleTest,
    handleToggle,
    handleDelete,
    handleGetLogs,
  };
}
