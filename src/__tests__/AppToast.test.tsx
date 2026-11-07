/**
 * toast 的容器掛在 App 層、ErrorBoundary 之外。ToastProvider 擺錯位置（例如搬到 I18nContext 外）時，
 * 平常沒有 toast 就看不出來，第一個 toast 跳出才壞——而且是整個視窗白屏。單元測試用全域 i18n mock，
 * 抓不到這件事，所以這裡用真的 App 與真的 i18n 實際跳一次 toast。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { App } from "../App";
import { queryClient } from "../lib/react-query";

// 系統匣的「Refresh All」走 Tauri 事件：在任何頁面都會觸發 refreshAll，部分失敗時跳 toast
const trayHandlers = new Map<string, () => void>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: () => void) => {
    trayHandlers.set(event, handler);
    return () => trayHandlers.delete(event);
  }),
}));
vi.mock("../i18n", async (importOriginal) => await importOriginal());
vi.mock("../api/sessionSecret", () => ({ getSessionSecret: async () => null }));

beforeAll(async () => {
  // 預設頁 Dashboard 是 lazy 載入：先抓進來，等待的時間就只花在連線與資料上
  await import("../pages/Dashboard");
  // 整套平行跑或冷啟動時，載入整個 Dashboard 可能超過 vitest 預設 10 秒的 hook 時限，整檔的測試被跳過、該檔記為失敗
}, 30_000);

beforeEach(() => {
  localStorage.clear(); // 預設落在 Dashboard
  trayHandlers.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      // 沒有追蹤中的 repo：Dashboard 只畫空狀態，不必替它的各個小工具 stub 端點
      const data = url.endsWith("/health")
        ? { status: "ok", service: "starscope-engine", timestamp: "2026-11-07T00:00:00+00:00" }
        : url.endsWith("/repos/fetch-all")
          ? { repos: [], total: 0, success_count: 3, failed_count: 2 }
          : url.includes("/repos")
            ? { repos: [], total: 0 }
            : url.includes("/early-signals/?")
              ? { signals: [], total: 0 }
              : [];
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data, message: "", error: null }),
      } as Response;
    })
  );
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe("App toasts", () => {
  it("shows a toast raised from the tray with the real app providers", async () => {
    render(<App />);
    expect(
      await screen.findByText("Overview of your tracked repositories", {}, { timeout: 3000 })
    ).toBeInTheDocument();
    const refreshFromTray = trayHandlers.get("refresh-all");
    expect(refreshFromTray).toBeDefined();

    await act(async () => {
      refreshFromTray?.();
    });

    expect(
      await screen.findByText("Refreshed 3, 2 failed — data for those repos is stale")
    ).toBeInTheDocument();
  });
});
