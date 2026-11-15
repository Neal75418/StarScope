/**
 * 通用確認 dialog 元件，取代瀏覽器原生 confirm()。
 */

import { useId } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useOverlayDismiss } from "../hooks/useOverlayDismiss";

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
  const overlayDismiss = useOverlayDismiss(onCancel, !isProcessing);

  if (!isOpen) return null;

  const confirmButtonClass =
    variant === "danger"
      ? "btn btn-danger"
      : variant === "warning"
        ? "btn btn-warning"
        : "btn btn-primary";

  // 掛到 document.body：祖先只要帶著 transform（頁面容器 .animated-page 在進場動畫期間就有），
  // 子孫的 position:fixed 會改成相對於它定位——遮罩就不再是一個視窗大小的固定層，
  // 而是整份文件那麼高，對話框被置中在文件正中央。
  return createPortal(
    <div className="dialog-overlay" {...overlayDismiss} role="none" tabIndex={-1}>
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
    </div>,
    document.body
  );
}
