/**
 * 在 Tauri 裡：health 不驗 session secret，別人的 sidecar（舊版孤兒、正在退出的上一個）也答得出來。
 * 所以要等 Rust 說「自己的 sidecar 已啟動」才探測；Rust 說被佔用、沒能啟動、已結束時不探測，
 * 並把原因交給畫面（見 src-tauri/src/lib.rs 的 SidecarStatus）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
import { render, screen, act, cleanup } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../../lib/react-query";
import { AppStatusProvider, useAppStatus } from "../../contexts/AppStatusContext";
import { SLOW_PROBE_MS, useSidecarBlock } from "../sidecarConnection";
import { API_ENDPOINT } from "../../config";

type RustStatus =
  | { kind: "starting" | "running" | "external" | "spawn_failed" }
  | { kind: "port_in_use"; holder: "starscope" | "other" }
  | { kind: "exited"; code: number | null };

let rustStatus: RustStatus = { kind: "starting" };
let emitStatus: (status: RustStatus) => void = () => {};
let invokeDelay: Promise<void> = Promise.resolve();
let invokeFails = false;
/** listen 何時註冊完成（StrictMode 下第一輪的 listen 可能在 stop 之後才回來） */
let listenDelay: Promise<void> = Promise.resolve();
/** 目前還掛著的 sidecar-status 監聽器 */
const activeHandlers = new Set<(e: { payload: RustStatus }) => void>();
/** 設了就讓下一次 health 掛著，直到呼叫它 */
let holdHealth: Promise<void> | null = null;

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(async (command: string) => {
    if (command !== "get_sidecar_status") throw new Error(`unexpected ${command}`);
    if (invokeFails) throw new Error("ipc unavailable");
    const snapshot = rustStatus;
    await invokeDelay;
    return snapshot;
  }),
}));
// 依事件名稱記：app 別處也會 listen（例如系統列的 refresh-all），不能把狀態送錯人
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: (e: { payload: RustStatus }) => void) => {
    if (event !== "sidecar-status") return () => {};
    await listenDelay;
    activeHandlers.add(handler);
    emitStatus = (status) => activeHandlers.forEach((h) => h({ payload: status }));
    return () => {
      activeHandlers.delete(handler);
    };
  }),
}));
vi.mock("../sessionSecret", () => ({ getSessionSecret: async () => null }));

const healthCalls = () =>
  fetchMock.mock.calls.filter(([url]) => String(url) === `${API_ENDPOINT}/health`).length;

const fetchMock = vi.fn(async (_input: RequestInfo | URL) => {
  if (holdHealth) await holdHealth;
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: { status: "ok", service: "starscope-engine" } }),
  } as Response;
});

function Probe() {
  const { level } = useAppStatus();
  const block = useSidecarBlock();
  return (
    <div>
      <span data-testid="level">{level}</span>
      <span data-testid="block">{block ? JSON.stringify(block) : "none"}</span>
    </div>
  );
}

const renderApp = ({ strict = false }: { strict?: boolean } = {}) => {
  const tree = (
    <QueryClientProvider client={queryClient}>
      <AppStatusProvider>
        <Probe />
      </AppStatusProvider>
    </QueryClientProvider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
};

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  rustStatus = { kind: "starting" };
  invokeDelay = Promise.resolve();
  invokeFails = false;
  listenDelay = Promise.resolve();
  activeHandlers.clear();
  holdHealth = null;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
});

afterEach(async () => {
  cleanup();
  await vi.runOnlyPendingTimersAsync();
  queryClient.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("sidecar connection inside Tauri", () => {
  it("does not probe health until Rust says its own sidecar is running", async () => {
    renderApp();
    await advance(5_000);
    expect(healthCalls()).toBe(0); // 這時答話的可能是別人的 sidecar
    expect(screen.getByTestId("level")).toHaveTextContent("sidecar-starting");

    act(() => emitStatus({ kind: "running" }));
    await advance(100);

    expect(healthCalls()).toBeGreaterThan(0);
    expect(screen.getByTestId("level")).toHaveTextContent("online");
  });

  it("probes right away in development, where start-dev.sh provides the sidecar", async () => {
    rustStatus = { kind: "external" };
    renderApp();
    await advance(100);

    expect(screen.getByTestId("level")).toHaveTextContent("online");
  });

  it("never probes a port held by someone else and says who holds it", async () => {
    rustStatus = { kind: "port_in_use", holder: "starscope" };
    renderApp();
    await advance(10_000);

    expect(healthCalls()).toBe(0);
    expect(screen.getByTestId("level")).toHaveTextContent("sidecar-down");
    expect(screen.getByTestId("block")).toHaveTextContent('"kind":"port_in_use"');
    expect(screen.getByTestId("block")).toHaveTextContent('"holder":"starscope"');
  });

  it("stops probing and reports it when a sidecar it once reached exits", async () => {
    rustStatus = { kind: "running" };
    renderApp();
    await advance(100);
    expect(screen.getByTestId("level")).toHaveTextContent("online");

    act(() => emitStatus({ kind: "exited", code: 1 }));
    const callsAtExit = healthCalls();
    await advance(120_000);

    expect(screen.getByTestId("level")).toHaveTextContent("sidecar-down");
    expect(screen.getByTestId("block")).toHaveTextContent('"code":1');
    expect(healthCalls()).toBe(callsAtExit); // 沒有自動重啟：一直探也不會好
  });

  it("does not let a probe that was already in flight undo an exit", async () => {
    // 例行探測已拿到 ok、還沒處理完時 Rust 說 sidecar 結束了：不能又把狀態改回連上
    rustStatus = { kind: "running" };
    renderApp();
    await advance(100);
    expect(screen.getByTestId("level")).toHaveTextContent("online");

    let releaseHealth: () => void = () => {};
    holdHealth = new Promise((resolve) => {
      releaseHealth = resolve;
    });
    const callsBefore = healthCalls();
    await advance(SLOW_PROBE_MS); // 下一次例行探測發出、掛著
    expect(healthCalls()).toBe(callsBefore + 1); // 確定真的有一個探測在途中
    act(() => emitStatus({ kind: "exited", code: 1 }));
    holdHealth = null;
    await act(async () => {
      releaseHealth();
    });
    await advance(100);

    expect(screen.getByTestId("level")).toHaveTextContent("sidecar-down");
  });

  it("keeps a single listener under StrictMode even when listen resolves late", async () => {
    // StrictMode：start → stop → start。第一輪的 listen 在 stop 之後才回來，必須自己退掉
    let releaseListen: () => void = () => {};
    listenDelay = new Promise((resolve) => {
      releaseListen = resolve;
    });
    rustStatus = { kind: "running" };
    renderApp({ strict: true });
    await act(async () => {
      releaseListen();
    });
    await advance(100);

    expect(activeHandlers.size).toBe(1);
    expect(screen.getByTestId("level")).toHaveTextContent("online");
  });

  it("stops listening when it stops", async () => {
    rustStatus = { kind: "running" };
    renderApp();
    await advance(100);
    expect(activeHandlers.size).toBe(1);

    cleanup();

    expect(activeHandlers.size).toBe(0);
  });

  it("falls back to probing when it cannot ask Rust", async () => {
    // 讀不到狀態（不該發生）時至少不要永遠停在啟動中
    invokeFails = true;
    renderApp();
    await advance(100);

    expect(screen.getByTestId("level")).toHaveTextContent("online");
  });

  it("reports a sidecar that could not be started", async () => {
    rustStatus = { kind: "spawn_failed" };
    renderApp();
    await advance(100);

    expect(screen.getByTestId("block")).toHaveTextContent('"kind":"spawn_failed"');
    expect(healthCalls()).toBe(0);
  });

  it("does not let a late answer to its own question overwrite a newer event", async () => {
    // 先 listen 再 invoke：兩者之間送出的事件比 invoke 的回答新。
    // 回答說 running、事件說 port 被佔用：採用舊回答就會去探測別人的 sidecar
    let release: () => void = () => {};
    invokeDelay = new Promise((resolve) => {
      release = resolve;
    });
    rustStatus = { kind: "running" };
    renderApp();
    await advance(10);

    act(() => emitStatus({ kind: "port_in_use", holder: "starscope" }));
    await act(async () => {
      release();
    });
    await advance(5_000);

    expect(healthCalls()).toBe(0);
    expect(screen.getByTestId("block")).toHaveTextContent('"kind":"port_in_use"');
  });

  it("does not probe on a manual retry while Rust has not said its sidecar is running", async () => {
    // 閘門關著時，連「立即重試」也不能探測：答話的可能是別人的 sidecar，會以為連上而整片 403。
    // （實際時序裡 Rust 最慢約 30 秒就有結果，這裡用停在 starting 來單獨驗閘門）
    const { probeSidecarNow } = await import("../sidecarConnection");
    renderApp();
    await advance(46_000);
    expect(screen.getByTestId("level")).toHaveTextContent("sidecar-down");

    act(() => probeSidecarNow());
    await advance(1_000);

    expect(healthCalls()).toBe(0);
    expect(screen.getByTestId("level")).toHaveTextContent("sidecar-down");
  });
});
