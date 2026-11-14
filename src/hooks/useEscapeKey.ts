/**
 * 按下 Esc 時呼叫 handler（關閉對話框、下拉選單這類浮層）。
 */

import { useEffect } from "react";

/** 輸入法處理掉的 keydown，keyCode 是 229（UI Events 規格） */
const IME_PROCESSED_KEYCODE = 229;

export function useEscapeKey(handler: (event: KeyboardEvent) => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 輸入法組字到一半的 Esc 是取消組字，不是關閉浮層。只看 isComposing 不夠：macOS 的 WebKit
      // （含 Tauri 的 WKWebView）把結束組字的那次 keydown 排在 compositionend 之後才送，
      // isComposing 已經是 false，只剩 keyCode 認得出來（WebKit bug 165004）
      if (event.isComposing || event.keyCode === IME_PROCESSED_KEYCODE) return;
      handler(event);
    };

    // capture 階段：對話框會擋掉框內 keydown 往上傳（不讓頁面的快捷鍵收到），
    // 掛在 bubble 階段的話，焦點在框內時永遠收不到 Esc
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [handler, enabled]);
}
