/**
 * Dialog for adding a new repository to the watchlist.
 */

import { useState } from "react";

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
  const [input, setInput] = useState("");

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
    <div className="dialog-overlay" onClick={handleClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>Add Repository</h2>
          <button onClick={handleClose} className="btn btn-sm">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="dialog-body">
            <p className="dialog-hint">
              Enter a GitHub repository in one of these formats:
            </p>
            <ul className="dialog-examples">
              <li>owner/repo (e.g., facebook/react)</li>
              <li>https://github.com/owner/repo</li>
            </ul>

            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="facebook/react"
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
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isLoading || !input.trim()}
            >
              {isLoading ? "Adding..." : "Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
