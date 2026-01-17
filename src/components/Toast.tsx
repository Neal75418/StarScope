/**
 * Toast notification component.
 * Displays temporary success, error, or info messages.
 */

import { useEffect } from "react";

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastProps {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
  duration?: number;
}

export function Toast({ toast, onDismiss, duration = 4000 }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, duration);

    return () => clearTimeout(timer);
  }, [toast.id, onDismiss, duration]);

  const icons: Record<ToastType, string> = {
    success: "\u2713",
    error: "\u2717",
    info: "\u2139",
    warning: "\u26a0",
  };

  return (
    <div className={`toast toast-${toast.type}`}>
      <span className="toast-icon">{icons[toast.type]}</span>
      <span className="toast-message">{toast.message}</span>
      <button
        className="toast-dismiss"
        onClick={() => onDismiss(toast.id)}
      >
        &times;
      </button>
    </div>
  );
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

// Hook for managing toasts
import { useState, useCallback } from "react";

export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setToasts((prev) => [...prev, { id, type, message }]);
    return id;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const success = useCallback(
    (message: string) => addToast("success", message),
    [addToast]
  );

  const error = useCallback(
    (message: string) => addToast("error", message),
    [addToast]
  );

  const info = useCallback(
    (message: string) => addToast("info", message),
    [addToast]
  );

  const warning = useCallback(
    (message: string) => addToast("warning", message),
    [addToast]
  );

  return {
    toasts,
    addToast,
    dismissToast,
    success,
    error,
    info,
    warning,
  };
}
