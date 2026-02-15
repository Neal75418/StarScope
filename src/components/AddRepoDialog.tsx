/**
 * 新增 repo 到 watchlist 的 dialog。
 */

import { useState, FormEvent } from "react";
import { useI18n } from "../i18n";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useEscapeKey } from "../hooks/useEscapeKey";

interface AddRepoDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (input: string) => Promise<void>;
  isLoading?: boolean;
  error?: string | null;
}

export function AddRepoDialog({ isOpen, onClose, onAdd, isLoading, error }: AddRepoDialogProps) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const focusTrapRef = useFocusTrap(isOpen, false);

  // 按 ESC 關閉 dialog
  useEscapeKey(() => {
    setInput("");
    onClose();
  }, isOpen && !isLoading);

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
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
        ref={focusTrapRef}
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
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
            <p className="dialog-hint">{t.dialog.addRepo.hint}</p>
            <ul className="dialog-examples">
              <li>{t.dialog.addRepo.exampleFormat}</li>
              <li>{t.dialog.addRepo.exampleUrl}</li>
            </ul>

            <label htmlFor="add-repo-input" className="sr-only">
              {t.dialog.addRepo.placeholder}
            </label>
            <input
              id="add-repo-input"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t.dialog.addRepo.placeholder}
              className="input"
              autoFocus
              disabled={isLoading}
              aria-describedby={error ? "add-repo-error" : undefined}
            />

            {error && (
              <p id="add-repo-error" className="error-message" role="alert">
                {error}
              </p>
            )}
          </div>

          <div className="dialog-footer">
            <button type="button" onClick={handleClose} className="btn" disabled={isLoading}>
              {t.common.cancel}
            </button>
            <button type="submit" className="btn btn-primary" disabled={isLoading || !input.trim()}>
              {isLoading ? t.common.loading : t.dialog.addRepo.add}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
