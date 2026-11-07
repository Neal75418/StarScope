/**
 * Toast 通知：暫時性的成功、錯誤或資訊訊息，由 app 層唯一的 ToastProvider 顯示。
 */

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import { useI18n } from "../i18n";
import { generateId } from "../utils/id";

type ToastType = "success" | "error" | "info" | "warning";

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

/** 預設顯示 4 秒 */
export function Toast({ toast, onDismiss, duration = 4000 }: ToastProps) {
  const { t } = useI18n();

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
    <div
      className={`toast toast-${toast.type}`}
      role={toast.type === "error" ? "alert" : undefined}
    >
      <span className="toast-icon">{icons[toast.type]}</span>
      <span className="toast-message">{toast.message}</span>
      <button
        className="toast-dismiss"
        onClick={() => onDismiss(toast.id)}
        aria-label={t.common.dismiss}
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

function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

export interface ToastApi {
  addToast: (type: ToastType, message: string) => string;
  dismissToast: (id: string) => void;
  success: (message: string) => string;
  error: (message: string) => string;
  info: (message: string) => string;
  warning: (message: string) => string;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * 整個 app 唯一的 toast 狀態與容器，掛在 App 層。
 *
 * context 只放方法、不放 toasts 陣列：呼叫端不會因為別處跳出 toast 而重新渲染。
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = generateId();
    setToasts((prev) => [...prev, { id, type, message }]);
    return id;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      addToast,
      dismissToast,
      success: (message) => addToast("success", message),
      error: (message) => addToast("error", message),
      info: (message) => addToast("info", message),
      warning: (message) => addToast("warning", message),
    }),
    [addToast, dismissToast]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

/**
 * 顯示 toast。必須在 ToastProvider 底下：沒有容器時訊息不會出現在任何地方，
 * 所以直接拋錯，讓漏包 Provider 在開發與測試時就壞掉，而不是使用者看不到失敗。
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) {
    throw new Error("useToast 必須在 ToastProvider 底下使用");
  }
  return api;
}
