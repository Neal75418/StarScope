/**
 * 將焦點限制在容器元素內（如對話框）：Tab／Shift+Tab 在框內循環；焦點在框外時，下一次 Tab／Shift+Tab 拉回框內。
 */

import { useEffect, useRef } from "react";
import type { RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 作用中的 trap，由下到上。只有最上層的那個處理 Tab：疊著兩個對話框時，
 * 底下那個會把上層的焦點當成「在框外」搶回去。
 */
const activeTraps: HTMLElement[] = [];

export function useFocusTrap(
  isActive: boolean,
  autoFocus = true
): RefObject<HTMLDivElement | null> {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!isActive || !container) return;

    // 儲存目前焦點元素，後續還原
    previousFocusRef.current = document.activeElement as HTMLElement;

    // 聚焦容器內第一個可聚焦元素（呼叫端自行管理焦點時跳過）
    if (autoFocus) {
      const focusableElements = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusableElements.length > 0) {
        focusableElements[0].focus();
      }
    }

    activeTraps.push(container);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || activeTraps[activeTraps.length - 1] !== container) return;
      // 容器已被移出 document（呼叫端另有條件控制渲染）：沒有框可以守，不攔
      if (!container.isConnected) return;

      const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      // 框內沒有可以停的地方（處理中，按鈕全停用）：擋下 Tab，不讓焦點走到框後面的頁面
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      // 焦點不在框內（點了框內的文字、原本聚焦的按鈕被停用）時，Tab 一律回到框內
      const isOutside = !container.contains(active);

      if (e.shiftKey) {
        if (isOutside || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (isOutside || active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    // capture 階段：對話框會擋掉框內 keydown 往上傳（不讓頁面的快捷鍵收到），
    // 掛在 bubble 階段的話，焦點在框內時永遠收不到 Tab
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      const index = activeTraps.lastIndexOf(container);
      if (index !== -1) activeTraps.splice(index, 1);
      // 還原先前的焦點元素。preventScroll：那個元素在對話框打開前就在視野內，
      // 而 .focus() 預設會把元素捲進視野——關閉確認框時把頁面捲走，使用者會
      // 突然找不到自己剛操作的那一列。
      previousFocusRef.current?.focus({ preventScroll: true });
    };
  }, [isActive, autoFocus]);

  return containerRef;
}
