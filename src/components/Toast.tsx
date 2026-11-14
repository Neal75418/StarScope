/**
 * Toast 通知：暫時性的成功、錯誤、警告或資訊訊息，由 app 層唯一的 ToastProvider 顯示。
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useSyncExternalStore,
} from "react";
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
  /** 暫停倒數；放開後重新計時 */
  paused?: boolean;
}

/**
 * 各類型顯示多久後自己消失。錯誤與警告留得比成功久：內容較長，也常在使用者沒盯著畫面時跳出來
 * （重新整理跑完、批次操作結束）。
 *
 * 不做成「不關就一直留著」：描述當下狀態的訊息（「3 個失敗，顯示的仍是舊資料」）在下一次成功之後
 * 就不成立了，留著等於畫面上掛著一句錯的話，除非每個呼叫端都記得自己關掉。
 */
const AUTO_DISMISS_MS: Record<ToastType, number> = {
  success: 4000,
  info: 4000,
  warning: 10_000,
  error: 10_000,
};

export function Toast({ toast, onDismiss, paused = false }: ToastProps) {
  const { t } = useI18n();

  useEffect(() => {
    if (paused) return;

    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, AUTO_DISMISS_MS[toast.type]);

    return () => clearTimeout(timer);
  }, [toast.id, toast.type, onDismiss, paused]);

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
      data-toast-id={toast.id}
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

function subscribeWindowVisibility(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function isWindowHidden(): boolean {
  return document.hidden;
}

/** 事件發生在哪一則 toast 上；不在任何一則上（落在兩則之間的空隙）時是 null */
function toastIdAt(target: EventTarget): string | null {
  return (target as HTMLElement).closest<HTMLElement>("[data-toast-id]")?.dataset.toastId ?? null;
}

function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  // 滑鼠停在某一則上、或焦點在某一則裡面時，整疊都不倒數：還在讀、或正要按關閉，
  // 旁邊的自己消失會讓整疊跳動。
  // 記的是「哪一則」而不是一個布林值：被關掉的那則直接從 DOM 消失，不會有 blur／mouseleave，
  // 布林值會卡在 true，之後的 toast 永遠不倒數；記 id 的話，那一則不在了就自然不算數
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const isShowing = (id: string | null) => id !== null && toasts.some((toast) => toast.id === id);

  // 視窗看不到時（最小化、切到別的分頁或桌面）也不倒數：計時器在背景照跑，
  // 回來時訊息早就消失，等於沒顯示過
  const windowHidden = useSyncExternalStore(subscribeWindowVisibility, isWindowHidden);

  const paused = windowHidden || isShowing(hoveredId) || isShowing(focusedId);

  // 沒有 toast 時也留著空的容器：live region 要先存在，之後插進來的內容才會被報讀；
  // 和第一則 toast 一起掛上的話，那一則可能不會被唸出來（role="alert" 的錯誤訊息瀏覽器另有處理）。
  // aria-atomic 明寫 false：role="status" 預設是 true，容器裡同時有好幾則時，每加一則整塊都會被重唸
  return (
    <div
      className="toast-container"
      role="status"
      aria-live="polite"
      aria-atomic="false"
      onMouseOver={(event) => setHoveredId(toastIdAt(event.target))}
      onMouseLeave={() => setHoveredId(null)}
      onFocus={(event) => setFocusedId(toastIdAt(event.target))}
      onBlur={() => setFocusedId(null)}
    >
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} paused={paused} />
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
    // 同類型、同一句的舊訊息先拿掉：連續失敗（斷線時連按）不會疊出一排一樣的字。
    // 換成新的一則而不是沿用舊的：新節點會重新滑入、重新報讀，看得出這一次也有反應
    setToasts((prev) => [
      ...prev.filter((shown) => shown.type !== type || shown.message !== message),
      { id, type, message },
    ]);
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
