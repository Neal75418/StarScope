/**
 * URL 驗證與安全開啟工具。
 */

import { openUrl } from "@tauri-apps/plugin-opener";
import { logger } from "./logger";

/** 允許開啟的 URL protocol */
const ALLOWED_PROTOCOLS = ["https:", "http:"];

/** 禁止開啟的 hostname — 防止內部端點存取（含 IPv6-mapped loopback） */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "[::ffff:7f00:1]",
]);

/**
 * 驗證 URL 是否為安全的 HTTP(S) URL。
 * 同時阻擋指向本機的請求以防止 sidecar 端點被存取。
 */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) return false;
    if (BLOCKED_HOSTNAMES.has(parsed.hostname)) return false;
    return true;
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
