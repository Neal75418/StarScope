/**
 * Rust 回報探測不會好的原因時（port 被佔用、沒能啟動、已結束），不掛頁面，直接說原因與怎麼辦。
 * 不掛頁面：port 被舊版孤兒佔著時 health 答得出來，頁面會以為連上、每個請求都 403。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { App } from "../App";
import { queryClient } from "../lib/react-query";

type RustStatus =
  | { kind: "starting" | "running" | "external" | "spawn_failed" }
  | { kind: "port_in_use"; holder: "starscope" | "other" }
  | { kind: "exited"; code: number | null };

let rustStatus: RustStatus = { kind: "starting" };
let emitStatus: (status: RustStatus) => void = () => {};

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(async (command: string) => {
    if (command === "get_sidecar_status") return rustStatus;
    throw new Error(`unexpected ${command}`);
  }),
}));
// 依事件名稱記：app 別處也會 listen（例如系統列的 refresh-all），不能把狀態送錯人
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: (e: { payload: RustStatus }) => void) => {
    if (event !== "sidecar-status") return () => {};
    emitStatus = (status) => handler({ payload: status });
    return () => {
      emitStatus = () => {};
    };
  }),
}));
vi.mock("../i18n", async (importOriginal) => await importOriginal());
vi.mock("../api/sessionSecret", () => ({ getSessionSecret: async () => null }));

beforeAll(async () => {
  await import("../pages/Dashboard");
});

beforeEach(() => {
  localStorage.clear();
  rustStatus = { kind: "starting" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
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
  vi.useFakeTimers();
});

afterEach(async () => {
  cleanup();
  await vi.runOnlyPendingTimersAsync();
  queryClient.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe("App when Rust reports why the sidecar is unavailable", () => {
  it("names a leftover StarScope service holding the port and how to clear it", async () => {
    rustStatus = { kind: "port_in_use", holder: "starscope" };
    render(<App />);
    await advance(100);

    const card = screen.getByTestId("sidecar-unavailable");
    expect(card).toHaveTextContent(/Another StarScope background service is using port 8008/);
    expect(card).toHaveTextContent(/starscope-sidecar/);
    expect(screen.getByTestId("status-banner")).toHaveTextContent(/Port 8008 is in use/);
    expect(screen.queryByText("Overview of your tracked repositories")).toBeNull();
  });

  it("names another program holding the port", async () => {
    rustStatus = { kind: "port_in_use", holder: "other" };
    render(<App />);
    await advance(100);

    expect(screen.getByTestId("sidecar-unavailable")).toHaveTextContent(
      /Another program is using port 8008/
    );
  });

  it("says the engine could not start", async () => {
    rustStatus = { kind: "spawn_failed" };
    render(<App />);
    await advance(100);

    expect(screen.getByTestId("sidecar-unavailable")).toHaveTextContent(
      /The data engine couldn't start/
    );
  });

  it("replaces the pages when a running engine stops, with its exit code", async () => {
    rustStatus = { kind: "running" };
    render(<App />);
    await advance(1_000);
    expect(screen.getByText("Overview of your tracked repositories")).toBeInTheDocument();

    act(() => emitStatus({ kind: "exited", code: 1 }));
    await advance(100);

    const card = screen.getByTestId("sidecar-unavailable");
    expect(card).toHaveTextContent(/The data engine has stopped/);
    expect(card).toHaveTextContent(/Exit code 1/);
    expect(screen.getByTestId("status-banner")).toHaveTextContent(/The data engine has stopped/);
    expect(screen.queryByText("Overview of your tracked repositories")).toBeNull();
  });

  it("switches to the real reason when Rust reports it after the startup window", async () => {
    // 原因晚於啟動時間才到時，畫面要從「沒有回應」換成真正的原因
    // （實際時序裡 Rust 最慢約 30 秒就有結果，這裡把它拉長來驗「已經 down 還要通知」）
    render(<App />);
    await advance(46_000);
    expect(screen.getByTestId("sidecar-unavailable")).toHaveTextContent(
      /The data engine is not responding/
    );

    act(() => emitStatus({ kind: "port_in_use", holder: "other" }));
    await advance(100);

    expect(screen.getByTestId("sidecar-unavailable")).toHaveTextContent(
      /Another program is using port 8008/
    );
  });

  it("leaves out the exit code line when the engine exited without one", async () => {
    rustStatus = { kind: "exited", code: null };
    render(<App />);
    await advance(100);

    const card = screen.getByTestId("sidecar-unavailable");
    expect(card).toHaveTextContent(/The data engine has stopped/);
    expect(card).not.toHaveTextContent(/Exit code/);
  });

  it("offers a retry only where retrying can help", async () => {
    // 被佔用、沒能啟動、已結束都不會因為重試而好：只留「重新開啟」的指示
    rustStatus = { kind: "port_in_use", holder: "other" };
    render(<App />);
    await advance(100);

    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });
});
