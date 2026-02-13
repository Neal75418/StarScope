/**
 * URL 驗證與安全開啟工具。
 */

import { openUrl } from "@tauri-apps/plugin-opener";
import { logger } from "./logger";

/** 允許開啟的 URL protocol */
const ALLOWED_PROTOCOLS = ["https:", "http:"];

/**
 * 驗證 URL 是否為安全的 HTTP(S) URL。
 */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_PROTOCOLS.includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * 安全地用系統瀏覽器開啟 URL，僅允許 HTTP(S)。
 */
export async function safeOpenUrl(url: string): Promise<void> {
  if (!isSafeUrl(url)) {
    logger.warn("[safeOpenUrl] 拒絕開啟不安全的 URL:", url);
    return;
  }
  await openUrl(url);
}
