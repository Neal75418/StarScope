/**
 * Dialog for adding a new repository to the watchlist.
 */

import { useState, useEffect } from "react";
import { useI18n } from "../i18n";

interface AddRepoDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (input: string) => Promise<void>;
  isLoading?: boolean;
  error?: string | null;
}

export function AddRepoDialog({
  isOpen,
  onClose,
  onAdd,
  isLoading,
  error,
}: AddRepoDialogProps) {
  const { t } = useI18n();
  const [input, setInput] = useState("");

  // Handle ESC key to close dialog
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isLoading) {
        setInput("");
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isLoading, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    await onAdd(input.trim());
    setInput("");
  };

  const handleClose = () => {
    setInput("");
    onClose();
  };

  return (
    <div className="dialog-overlay" onClick={handleClose} role="presentation">
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-repo-dialog-title"
      >
        <div className="dialog-header">
          <h2 id="add-repo-dialog-title">{t.dialog.addRepo.title}</h2>
          <button onClick={handleClose} className="btn btn-sm" aria-label={t.common.close}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="dialog-body">
            <p className="dialog-hint">
              {t.dialog.addRepo.hint}
            </p>
            <ul className="dialog-examples">
              <li>owner/repo (e.g., facebook/react)</li>
              <li>https://github.com/owner/repo</li>
            </ul>

            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t.dialog.addRepo.placeholder}
              className="input"
              autoFocus
              disabled={isLoading}
            />

            {error && <p className="error-message">{error}</p>}
          </div>

          <div className="dialog-footer">
            <button
              type="button"
              onClick={handleClose}
              className="btn"
              disabled={isLoading}
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isLoading || !input.trim()}
            >
              {isLoading ? t.common.loading : t.dialog.addRepo.add}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
