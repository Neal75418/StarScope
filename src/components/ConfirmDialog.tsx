/**
 * Reusable confirmation dialog component.
 * Replaces native browser confirm() with a styled modal.
 */

import { useEffect, useId } from "react";
import { useI18n } from "../i18n";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText,
  cancelText,
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const resolvedConfirmText = confirmText ?? t.common.confirm;
  const resolvedCancelText = cancelText ?? t.common.cancel;
  const titleId = useId();
  const descId = useId();

  // Handle ESC key to close dialog
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onCancel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const confirmButtonClass =
    variant === "danger"
      ? "btn btn-danger"
      : variant === "warning"
        ? "btn btn-warning"
        : "btn btn-primary";

  return (
    <div className="dialog-overlay" onClick={onCancel} role="presentation">
      <div
        className="dialog confirm-dialog"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <div className="dialog-header">
          <h2 id={titleId}>{title}</h2>
        </div>

        <div className="dialog-body">
          <p id={descId}>{message}</p>
        </div>

        <div className="dialog-footer">
          <button type="button" onClick={onCancel} className="btn">
            {resolvedCancelText}
          </button>
          <button type="button" onClick={onConfirm} className={confirmButtonClass}>
            {resolvedConfirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
