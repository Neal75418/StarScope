/**
 * 存檔：Tauri 裡開原生「另存新檔」，瀏覽器裡（Vite 開發、e2e）退回 Blob 下載。
 *
 * Tauri 裡不能用 `<a download>`：wry 在沒有 download handler 時會直接取消 WKWebView 的下載，
 * macOS 上按了沒有任何反應。對話框與寫檔都在 Rust 的 `save_file` command 裡做，前端只交出
 * 內容與建議檔名，拿不到可寫的路徑（見 src-tauri/src/lib.rs）。
 */

import { invoke } from "@tauri-apps/api/core";
import { fetchExportFile } from "../api/client";

export type SaveResult = "saved" | "cancelled";

const MIME_TYPES: Record<string, string> = {
  json: "application/json",
  csv: "text/csv",
  txt: "text/plain",
  png: "image/png",
};

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

export async function saveFile(name: string, contents: string | Uint8Array): Promise<SaveResult> {
  const bytes = typeof contents === "string" ? new TextEncoder().encode(contents) : contents;

  if (isTauri()) {
    // 明寫成數字陣列（Rust 端是 Vec<u8>）：Tauri 2.11 的 IPC 目前也會自動轉，但那是它的內部實作
    const saved = await invoke<boolean>("save_file", {
      defaultName: name,
      contents: Array.from(bytes),
    });
    return saved ? "saved" : "cancelled";
  }

  const href = URL.createObjectURL(
    new Blob([bytes], { type: MIME_TYPES[extensionOf(name)] ?? "application/octet-stream" })
  );
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = name;
  anchor.click();
  // 延後釋放：WebKit 在 click 之後立刻 revoke 會讓下載失敗
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  return "saved";
}

/**
 * 取得匯出檔並存檔。先取內容再開對話框：sidecar 出錯時立刻回報，不讓使用者先選好位置
 * 才告訴他失敗，也不會留下空檔案。
 *
 * @param fallbackName 後端沒給檔名（例如 CORS 沒 expose Content-Disposition）時用的檔名
 */
export async function saveExport(url: string, fallbackName: string): Promise<SaveResult> {
  const { content, filename } = await fetchExportFile(url);
  return saveFile(filename ?? fallbackName, content);
}
