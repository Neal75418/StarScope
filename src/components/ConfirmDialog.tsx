/**
 * 通用確認 dialog 元件，取代瀏覽器原生 confirm()。
 */

import { useId } from "react";
import { useI18n } from "../i18n";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useEscapeKey } from "../hooks/useEscapeKey";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "default";
  isProcessing?: boolean;
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
  isProcessing = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const resolvedConfirmText = confirmText ?? t.common.confirm;
  const resolvedCancelText = cancelText ?? t.common.cancel;
  const titleId = useId();
  const descId = useId();
  const focusTrapRef = useFocusTrap(isOpen);

  // 按 ESC 關閉 dialog（processing 時停用）
  useEscapeKey(onCancel, isOpen && !isProcessing);

  if (!isOpen) return null;

  const confirmButtonClass =
    variant === "danger"
      ? "btn btn-danger"
      : variant === "warning"
        ? "btn btn-warning"
        : "btn btn-primary";

  return (
    <div
      className="dialog-overlay"
      onClick={isProcessing ? undefined : onCancel}
      role="presentation"
    >
      <div
        ref={focusTrapRef}
        className="dialog confirm-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
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
          <button type="button" onClick={onCancel} className="btn" disabled={isProcessing}>
            {resolvedCancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={confirmButtonClass}
            disabled={isProcessing}
          >
            {resolvedConfirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
