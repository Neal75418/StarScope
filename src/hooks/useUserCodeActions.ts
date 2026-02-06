/**
 * 使用者代碼的剪貼簿與 URL 操作。
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { DeviceCodeResponse } from "../api/client";
import { CLIPBOARD_FEEDBACK_MS } from "../constants/api";

interface UseUserCodeActionsResult {
  copied: boolean;
  copyUserCode: () => void;
  openGitHubManually: () => Promise<void>;
}

export function useUserCodeActions(
  deviceCode: DeviceCodeResponse | null
): UseUserCodeActionsResult {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 元件卸載時清除 timeout 防止記憶體洩漏
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const copyUserCode = useCallback(() => {
    if (deviceCode?.user_code) {
      void navigator.clipboard.writeText(deviceCode.user_code);
      setCopied(true);
      // 清除先前的 timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setCopied(false), CLIPBOARD_FEEDBACK_MS);
    }
  }, [deviceCode]);

  const openGitHubManually = useCallback(async () => {
    if (deviceCode?.verification_uri) {
      try {
        await openUrl(deviceCode.verification_uri);
      } catch {
        window.open(deviceCode.verification_uri, "_blank");
      }
    }
  }, [deviceCode]);

  return { copied, copyUserCode, openGitHubManually };
}
