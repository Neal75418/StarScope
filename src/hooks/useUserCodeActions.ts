/**
 * Hook for user code clipboard and URL actions.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { DeviceCodeResponse } from "../api/client";

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

  // Cleanup timeout on unmount to prevent memory leak
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
      // Clear previous timeout if exists
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
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
