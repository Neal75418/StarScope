/**
 * URL 驗證與安全開啟工具。
 */

import { openUrl } from "@tauri-apps/plugin-opener";
import { logger } from "./logger";

/** 允許開啟的 URL protocol */
const ALLOWED_PROTOCOLS = ["https:", "http:"];

/** 禁止開啟的 hostname — 防止內部端點存取 */
const BLOCKED_HOSTNAMES = new Set(["localhost", "0.0.0.0", "[::1]", "[::ffff:7f00:1]"]);

/** 私有/保留 IP 範圍（loopback、RFC 1918、link-local） */
const PRIVATE_IP_PATTERNS = [
  /^127\./, // 127.0.0.0/8 loopback
  /^10\./, // 10.0.0.0/8
  /^192\.168\./, // 192.168.0.0/16
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^169\.254\./, // link-local
  /^0\./, // 0.0.0.0/8
];

/** 私有/保留 IPv6 範圍（bracket-wrapped hostname 去除 [] 後比對） */
const PRIVATE_IPV6_PATTERNS = [
  /^::1$/, // loopback
  /^fe80:/i, // link-local
  /^fc/i, // unique local (fc00::/7 = fc00-fdff)
  /^fd/i, // unique local (fd00::/8)
  /^::ffff:7f/i, // IPv4-mapped 127.x (hex: 7f00-7fff)
  /^::ffff:a[0-9a-f]{2}:/i, // IPv4-mapped 10.x (hex: a00-aff)
  /^::ffff:c0a8:/i, // IPv4-mapped 192.168.x (hex: c0a8:)
  /^::ffff:ac1[0-9a-f]:/i, // IPv4-mapped 172.16-31.x (hex: ac10-ac1f)
];

/**
 * 驗證 URL 是否為安全的 HTTP(S) URL。
 * 同時阻擋指向本機或私有 IP 的請求以防止 sidecar 端點被存取。
 */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) return false;
    if (BLOCKED_HOSTNAMES.has(parsed.hostname)) return false;
    if (PRIVATE_IP_PATTERNS.some((p) => p.test(parsed.hostname))) return false;
    // IPv6: hostname 含 [] 時去除後比對私有範圍
    if (parsed.hostname.startsWith("[")) {
      const bare = parsed.hostname.slice(1, -1);
      if (PRIVATE_IPV6_PATTERNS.some((p) => p.test(bare))) return false;
    }
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
