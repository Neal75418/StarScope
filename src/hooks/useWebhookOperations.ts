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

  // Unified executor to reduce cognitive complexity and repetition
  const executeOperation = useCallback(
    async <R>(
      operation: () => Promise<R>,
      successMessage?: string,
      refreshOnSuccess: boolean = true
    ): Promise<R | undefined> => {
      try {
        const result = await operation();
        if (successMessage) {
          toast.success(successMessage);
        }
        if (refreshOnSuccess) {
          await onSuccess();
        }
        return result;
      } catch (err) {
        toast.error(getErrorMessage(err, t.settings.webhooks.toast.testFailed));
        return undefined;
      }
    },
    [toast, onSuccess, t]
  );

  const handleCreate = useCallback(
    async (webhook: WebhookCreate): Promise<boolean> => {
      const result = await executeOperation(
        () => createWebhook(webhook),
        t.settings.webhooks.toast.created
      );
      return result !== undefined;
    },
    [executeOperation, t]
  );

  const handleUpdate = useCallback(
    async (id: number, webhook: WebhookUpdate): Promise<boolean> => {
      const result = await executeOperation(
        () => updateWebhook(id, webhook),
        t.settings.webhooks.toast.updated
      );
      return result !== undefined;
    },
    [executeOperation, t]
  );

  const handleGetLogs = useCallback(
    async (id: number): Promise<WebhookLog[]> => {
      const logs = await executeOperation(
        async () => {
          const response = await getWebhookLogs(id);
          return response.logs;
        },
        undefined,
        false // Don't refresh list just for logs
      );
      return logs || [];
    },
    [executeOperation]
  );

  const handleTest = useCallback(
    async (id: number): Promise<void> => {
      // Test has custom logic for success/failure message based on result body
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
    [toast, onSuccess, t]
  );

  const handleToggle = useCallback(
    async (id: number): Promise<void> => {
      await executeOperation(() => toggleWebhook(id));
    },
    [executeOperation]
  );

  const handleDelete = useCallback(
    async (id: number): Promise<void> => {
      await executeOperation(() => deleteWebhook(id), t.settings.webhooks.toast.deleted);
    },
    [executeOperation, t]
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
