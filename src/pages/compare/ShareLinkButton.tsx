/**
 * 分享連結按鈕：將目前 URL（含 hash 狀態）複製到剪貼簿。
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { CLIPBOARD_FEEDBACK_MS } from "../../constants/api";
import { useI18n } from "../../i18n";

export function ShareLinkButton() {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => {
        setCopied(true);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => setCopied(false), CLIPBOARD_FEEDBACK_MS);
      })
      .catch(() => {
        // Clipboard write failed (permission denied, HTTP context, etc.) — silently ignore
      });
  }, []);

  return (
    <button className="btn btn-sm" onClick={handleCopy} data-testid="compare-share-btn">
      {copied ? t.compare.shareCopied : t.compare.share}
    </button>
  );
}
