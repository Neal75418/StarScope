/**
 * Hooks 共用型別定義。
 */

export interface Toast {
  success: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
  warning: (msg: string) => void;
}
