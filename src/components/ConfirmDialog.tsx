/**
 * Reusable confirmation dialog component.
 * Replaces native browser confirm() with a styled modal.
 */

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
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  const confirmButtonClass =
    variant === "danger"
      ? "btn btn-danger"
      : variant === "warning"
      ? "btn btn-warning"
      : "btn btn-primary";

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div
        className="dialog confirm-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <h2>{title}</h2>
        </div>

        <div className="dialog-body">
          <p>{message}</p>
        </div>

        <div className="dialog-footer">
          <button type="button" onClick={onCancel} className="btn">
            {cancelText}
          </button>
          <button type="button" onClick={onConfirm} className={confirmButtonClass}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
