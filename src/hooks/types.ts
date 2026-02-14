/**
 * Hooks 共用型別定義。
 */

export interface Toast {
  success: (msg: string) => void;
  error: (msg: string) => void;
}
