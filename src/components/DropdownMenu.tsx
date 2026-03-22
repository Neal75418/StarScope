/**
 * 通用下拉選單容器，處理開關狀態、點擊外部關閉、ESC 關閉。
 * 供各頁面的 export/presets 下拉選單複用。
 */

import { useCallback, useRef, useState, type ReactNode } from "react";
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
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    onClose?.();
    buttonRef.current?.focus();
  }, [onClose]);

  useClickOutside(ref, close, open);
  useEscapeKey(close, open);

  return (
    <div className="export-dropdown" ref={ref}>
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
          className={`export-dropdown-menu${menuClassName ? ` ${menuClassName}` : ""}`}
          role="menu"
          data-testid={menuTestId}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}
