/**
 * sidecar 還在啟動時不渲染頁面：查詢暫停中、還沒有資料時，頁面的 isLoading 是 false，
 * 會畫出「還沒追蹤任何專案」這類空狀態，老使用者會以為資料不見了。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react";
import { App } from "../App";
import { queryClient } from "../lib/react-query";
import { FAST_PROBE_MS, SLOW_PROBE_MS, STARTUP_GRACE_MS } from "../api/sidecarConnection";
import { API_ENDPOINT } from "../config";

vi.mock("../i18n", async (importOriginal) => await importOriginal());
vi.mock("../api/sessionSecret", () => ({ getSessionSecret: async () => null }));

let sidecarUp = false;
const sleep = (ms: number) =>
  act(async () => new Promise<void>((resolve) => setTimeout(resolve, ms)));

beforeAll(async () => {
  // 先把 lazy 載入的 Dashboard 抓進來：斷言靠的是 gate，不能靠 chunk 在時限內載完
  await import("../pages/Dashboard");
});

beforeEach(() => {
  localStorage.clear(); // 預設落在 Dashboard：不等 digest、直接渲染的那條路
  sidecarUp = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (!sidecarUp) throw new TypeError("Load failed");
      const url = String(input);
      // 形狀要對得上各端點：對不上的話 Dashboard 會畫錯誤卡，斷言就驗不到「頁面有掛上」
      const data = url.endsWith("/health")
        ? { status: "ok", service: "starscope-engine", timestamp: "2026-09-26T00:00:00+00:00" }
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
  vi.useRealTimers();
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe("App during a sidecar cold start", () => {
  it("shows a loader, not an empty dashboard, until the sidecar answers", async () => {
    render(<App />);
    await sleep(1_500);

    // 啟動中：頁面還沒掛載，當然也不會有空狀態
    expect(screen.queryByText("Overview of your tracked repositories")).toBeNull();
    expect(screen.queryByTestId("dashboard-onboard")).toBeNull();
    expect(screen.getByTestId("status-banner")).toHaveTextContent(
      /Starting the data engine|資料引擎啟動中/
    );

    sidecarUp = true;

    // 連上之後頁面才掛載
    expect(
      await screen.findByText("Overview of your tracked repositories", {}, { timeout: 3_000 })
    ).toBeInTheDocument();
    expect(screen.queryByText(/data is undefined/)).toBeNull();
  }, 15_000);

  it("says the engine is not running, not that there is no data, if it never answers", async () => {
    // 開機時就起不來（DB migration 失敗、spawn 失敗）或冷啟動超過啟動時間：
    // 過了啟動時間也不能掛上頁面，否則會在紅色橫幅下畫出「還沒追蹤任何專案」
    vi.useFakeTimers();
    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STARTUP_GRACE_MS + 1_000);
    });

    expect(screen.queryByTestId("dashboard-onboard")).toBeNull();
    expect(screen.queryByText("Overview of your tracked repositories")).toBeNull();
    expect(screen.getByTestId("sidecar-unavailable")).toHaveTextContent(
      /Data engine is not running/
    );

    // 之後起來了：按「立即重試」馬上連上、頁面掛上並開始抓資料。
    // 只推進 100ms：比 FAST_PROBE_MS 的下一輪自動探測早，確定是按鈕觸發的
    sidecarUp = true;
    const fetchesBefore = vi.mocked(fetch).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /Retry Now/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(screen.queryByTestId("sidecar-unavailable")).toBeNull();
    const pageFetches = vi
      .mocked(fetch)
      .mock.calls.slice(fetchesBefore)
      .map(([url]) => String(url))
      .filter((url) => !url.endsWith("/health"));
    expect(pageFetches).toContain(`${API_ENDPOINT}/repos`);
    // /repos 是 app 層的 WatchlistProvider 打的，證明不了頁面：直接看 Dashboard 有沒有畫出來
    expect(screen.getByText("Overview of your tracked repositories")).toBeInTheDocument();
    expect(screen.queryByText(/data is undefined/)).toBeNull();
  });

  it("keeps the page mounted when a sidecar it once reached goes away", async () => {
    // 中途斷線不換成「引擎沒在跑」的整頁卡片，也不卸掉頁面：紅色橫幅說明狀況
    vi.useFakeTimers();
    sidecarUp = true;
    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    sidecarUp = false;
    // 下一輪例行探測落空，FAST_PROBE_MS 後再落空一次 → 判定掛了
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SLOW_PROBE_MS + FAST_PROBE_MS + 200);
    });

    expect(screen.getByTestId("status-banner")).toHaveTextContent(/not running/);
    expect(screen.queryByTestId("sidecar-unavailable")).toBeNull();
    expect(screen.getByText("Overview of your tracked repositories")).toBeInTheDocument();
    expect(screen.queryByText(/data is undefined/)).toBeNull();
  });
});
