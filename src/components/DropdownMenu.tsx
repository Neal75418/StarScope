/**
 * 通用下拉選單容器。
 * 完整 ARIA menu pattern：ESC 關閉、focus return、arrow key 導航、auto-focus。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useClickOutside } from "../hooks/useClickOutside";
import { useEscapeKey } from "../hooks/useEscapeKey";

interface DropdownMenuProps {
  label: string;
  buttonTestId?: string;
  menuTestId?: string;
  menuClassName?: string;
  onClose?: () => void;
  children: (close: () => void) => ReactNode;
}

export function DropdownMenu({
  label,
  buttonTestId,
  menuTestId,
  menuClassName,
  onClose,
  children,
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    onClose?.();
    buttonRef.current?.focus();
  }, [onClose]);

  useClickOutside(containerRef, close, open);
  useEscapeKey(close, open);

  // 開啟時自動 focus 第一個 menuitem
  useEffect(() => {
    if (!open || !menuRef.current) return;
    const first = menuRef.current.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
  }, [open]);

  // Arrow key 導航
  const handleMenuKeyDown = useCallback((e: KeyboardEvent) => {
    if (!menuRef.current) return;
    const items = Array.from(menuRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    if (items.length === 0) return;

    const current = document.activeElement as HTMLElement;
    const index = items.indexOf(current);

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        items[index === -1 ? 0 : (index + 1) % items.length]?.focus();
        break;
      case "ArrowUp":
        e.preventDefault();
        items[index === -1 ? items.length - 1 : (index - 1 + items.length) % items.length]?.focus();
        break;
      case "Home":
        e.preventDefault();
        items[0]?.focus();
        break;
      case "End":
        e.preventDefault();
        items[items.length - 1]?.focus();
        break;
    }
  }, []);

  return (
    <div className="export-dropdown" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-sm"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid={buttonTestId}
      >
        {label}
      </button>
      {open && (
        <div
          ref={menuRef}
          className={`export-dropdown-menu${menuClassName ? ` ${menuClassName}` : ""}`}
          role="menu"
          data-testid={menuTestId}
          onKeyDown={handleMenuKeyDown}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}
