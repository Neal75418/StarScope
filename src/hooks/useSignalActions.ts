/**
 * Hook for signal action operations.
 */

import { useState, useCallback } from "react";
import {
  EarlySignalType,
  acknowledgeSignal,
  acknowledgeAllSignals,
  triggerDetection,
  deleteSignal,
} from "../api/client";
import { getErrorMessage } from "../utils/error";
import { useI18n, interpolate } from "../i18n";

interface ConfirmDialogState {
  isOpen: boolean;
  type: "acknowledgeAll" | "delete";
  signalId?: number;
}

interface UseSignalActionsProps {
  filterType: EarlySignalType | "";
  reload: () => Promise<void>;
  toast: {
    success: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export function useSignalActions({ filterType, reload, toast }: UseSignalActionsProps) {
  const { t } = useI18n();
  const [isDetecting, setIsDetecting] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    isOpen: false,
    type: "acknowledgeAll",
  });

  const handleAcknowledge = useCallback(
    async (signalId: number) => {
      try {
        await acknowledgeSignal(signalId);
        await reload();
      } catch (err) {
        toast.error(getErrorMessage(err, "Failed to acknowledge signal"));
      }
    },
    [reload, toast]
  );

  const openAcknowledgeAllDialog = useCallback(() => {
    setConfirmDialog({ isOpen: true, type: "acknowledgeAll" });
  }, []);

  const confirmAcknowledgeAll = useCallback(async () => {
    try {
      await acknowledgeAllSignals(filterType || undefined);
      toast.success(t.signals.toast.acknowledgedAll);
      await reload();
    } catch (err) {
      toast.error(getErrorMessage(err, t.signals.loadingError));
    } finally {
      setConfirmDialog({ isOpen: false, type: "acknowledgeAll" });
    }
  }, [filterType, reload, toast, t]);

  const openDeleteDialog = useCallback((signalId: number) => {
    setConfirmDialog({ isOpen: true, type: "delete", signalId });
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!confirmDialog.signalId) return;

    try {
      await deleteSignal(confirmDialog.signalId);
      toast.success(t.signals.toast.deleted);
      await reload();
    } catch (err) {
      toast.error(getErrorMessage(err, t.signals.loadingError));
    } finally {
      setConfirmDialog({ isOpen: false, type: "delete" });
    }
  }, [confirmDialog.signalId, reload, toast, t]);

  const closeDialog = useCallback(() => {
    setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleRunDetection = useCallback(async () => {
    setIsDetecting(true);
    try {
      const result = await triggerDetection();
      toast.success(
        interpolate(t.signals.detection.complete, {
          repos: result.repos_scanned,
          signals: result.signals_detected,
        })
      );
      await reload();
    } catch (err) {
      toast.error(getErrorMessage(err, t.signals.loadingError));
    } finally {
      setIsDetecting(false);
    }
  }, [reload, toast, t]);

  return {
    isDetecting,
    confirmDialog,
    handleAcknowledge,
    openAcknowledgeAllDialog,
    confirmAcknowledgeAll,
    openDeleteDialog,
    confirmDelete,
    closeDialog,
    handleRunDetection,
  };
}
