/**
 * Per-session secret 管理。
 *
 * Tauri 啟動時產生隨機 secret 並傳給 sidecar，
 * 前端透過 Tauri command 取得後附加至每個 API 請求 header，
 * sidecar 驗證 header 確保呼叫者為本機 Tauri 前端。
 */

import { invoke } from "@tauri-apps/api/core";
import { logger } from "../utils/logger";

/** Promise singleton — 合併並發呼叫，僅觸發一次 invoke */
let secretPromise: Promise<string | null> | null = null;

/**
 * 從 Tauri runtime 取得 session secret（僅首次呼叫時 invoke，之後使用快取）。
 * 在非 Tauri 環境（如單元測試、純瀏覽器開發）中回傳 null。
 */
export async function getSessionSecret(): Promise<string | null> {
  if (!secretPromise) {
    secretPromise = invoke<string>("get_session_secret").catch(() => {
      // 非 Tauri 環境或 invoke 失敗 — 重設以允許重試
      logger.warn("[sessionSecret] 無法取得 session secret，可能處於開發模式");
      secretPromise = null;
      return null;
    });
  }
  return secretPromise;
}
