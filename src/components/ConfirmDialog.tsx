/**
 * 通用確認 dialog 元件，取代瀏覽器原生 confirm()。
 */

import { useId } from "react";
import { createPortal } from "react-dom";
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

  // 掛到 document.body：頁面容器 .animated-page 帶著動畫結束狀態的 transform，
  // 而非 none 的 transform 會讓子孫的 position:fixed 改成相對於它定位——遮罩就
  // 不再是一個視窗大小的固定層，而是整份文件那麼高，對話框被置中在文件正中央。
  // 使用者點的是第一列，畫面卻捲到清單中段。
  return createPortal(
    <div
      className="dialog-overlay"
      onClick={isProcessing ? undefined : onCancel}
      role="none"
      tabIndex={-1}
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
    </div>,
    document.body
  );
}
