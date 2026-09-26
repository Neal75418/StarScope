/**
 * sidecar 連不連得上：全 app 只在這裡判斷。
 *
 * 打包版的 sidecar 冷啟動要 8–14 秒，中途也可能掛掉。這裡把「連得上」接到 React Query 的
 * onlineManager：連不上時查詢暫停（不算失敗、不耗重試），連上後自動接著跑。
 * 否則冷啟動期間發出的查詢會在幾秒內重試完放棄，要等使用者換頁才重抓。
 * mutation 不暫停：使用者按下的寫入要馬上知道結果（見 lib/react-query.ts 的 mutations.networkMode）。
 * 所有查詢都打本機的 sidecar，所以瀏覽器自己的 online/offline 不暫停它們（離線提示由
 * useOnlineStatus 負責）。
 *
 * 連不上時每 FAST_PROBE_MS 探一次 health，連上後每 SLOW_PROBE_MS 一次；API 請求遇到連線錯誤時
 * （doFetch 與 fetchExportFile 呼叫 reportSidecarUnreachable）立刻重探。探測直接打 fetch、不經 React Query：
 * 查詢暫停時它也得照跑，否則永遠發現不了 sidecar 已經起來。
 */

import { onlineManager } from "@tanstack/react-query";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";
import { API_ENDPOINT } from "../config";
import { logger } from "../utils/logger";

// 探測刻意用一般的 setTimeout，不套 useSmartInterval／可見性暫停：頁面隱藏時也得偵測 sidecar
// 復活，否則橫幅會一直掛著。不要「順手」改成只在可見時輪詢。

/** 還沒連上時的探測間隔 */
export const FAST_PROBE_MS = 500;
/** 連上之後的探測間隔 */
export const SLOW_PROBE_MS = 60_000;
/** 單次探測的逾時 */
export const PROBE_TIMEOUT_MS = 2_000;
/**
 * 已連上時，連續這麼多次探測落空才算掛了：sidecar 的 event loop 偶爾會被同步工作卡住超過
 * 一次探測的逾時，只憑一次就叫使用者重啟太敏感。第一次落空後 FAST_PROBE_MS 就重探確認。
 */
const MISSES_BEFORE_DOWN = 2;
/**
 * 從沒連上過、又超過這麼久，才從「啟動中」改說「沒有回應」。
 * onefile 裝好後第一次開實測 22.8 秒，CI runner 更慢。
 */
export const STARTUP_GRACE_MS = 45_000;

/** starting：這次開 app 還沒連上過、仍在啟動時間內；up：連得上；down：其餘 */
export type SidecarPhase = "starting" | "up" | "down";

/**
 * Rust 回報、探測查不出來的原因：探測不會好，所以不再探測（沒有自動重啟）。
 * 形狀與 src-tauri/src/lib.rs 的 SidecarStatus 序列化結果一致
 */
export type SidecarBlock =
  | { kind: "port_in_use"; holder: "starscope" | "other" }
  | { kind: "spawn_failed" }
  | { kind: "exited"; code: number | null };

type RustSidecarStatus = { kind: "starting" | "running" | "external" } | SidecarBlock;

/** Rust 在 sidecar 狀態變化時送出的事件 */
const SIDECAR_STATUS_EVENT = "sidecar-status";

let phase: SidecarPhase = "starting";
let everReachable = false;
let missesWhileUp = 0;
let running = false;
let probing = false;
let probeTimer: ReturnType<typeof setTimeout> | undefined;
let graceTimer: ReturnType<typeof setTimeout> | undefined;
let setQueriesOnline: ((online: boolean) => void) | null = null;
const listeners = new Set<() => void>();
let lastProbeError: string | null = null;
let block: SidecarBlock | null = null;
/**
 * 能不能探測 health。在 Tauri 裡要等 Rust 說 running／external 才打開：health 不驗 session
 * secret，別人的 sidecar（舊版孤兒、正在退出的上一個）也答得出來，前端會以為連上而整片 403
 */
let gateOpen = true;
/** 每次 start 加一：舊一輪還沒回來的 listen／invoke 結果不能影響這一輪（StrictMode 會 start 兩次） */
let generation = 0;
let unlistenRust: (() => void) | null = null;

function notify() {
  listeners.forEach((listener) => listener());
}

function setPhase(next: SidecarPhase) {
  if (next === phase) return;
  phase = next;
  setQueriesOnline?.(next === "up");
  notify();
}

function applyRustStatus(status: RustSidecarStatus) {
  switch (status.kind) {
    case "running":
    case "external":
      gateOpen = true;
      void probe();
      return;
    case "starting":
      gateOpen = false;
      return;
    default:
      gateOpen = false;
      clearTimeout(probeTimer);
      block = status;
      setPhase("down");
      notify(); // phase 本來就是 down 時 setPhase 不會通知
  }
}

/** 先 listen 再 invoke：兩者之間送出的事件比 invoke 的回答新，收過事件就不採用 invoke 的回答 */
async function connectToRust(gen: number) {
  const current = () => gen === generation && running;
  let heardEvent = false;
  try {
    const unlisten = await listen<RustSidecarStatus>(SIDECAR_STATUS_EVENT, (event) => {
      if (!current()) return;
      heardEvent = true;
      applyRustStatus(event.payload);
    });
    if (!current()) {
      unlisten();
      return;
    }
    unlistenRust = unlisten;
    const status = await invoke<RustSidecarStatus>("get_sidecar_status");
    if (current() && !heardEvent) applyRustStatus(status);
  } catch (err) {
    // 讀不到 Rust 的狀態（不該發生）：退回只靠探測，至少不會永遠停在啟動中
    logger.warn("[sidecarConnection] 讀不到 sidecar 狀態", err);
    if (current()) {
      gateOpen = true;
      void probe();
    }
  }
}

/**
 * 探測失敗記一筆，同一個原因只記一次：冷啟動期間每 FAST_PROBE_MS 就落空一次，
 * 換了原因（例如程式錯誤而不是連線被拒）才再記，否則「永遠連不上」會查不到線索。
 */
function noteProbeFailure(reason: string) {
  if (reason === lastProbeError) return;
  lastProbeError = reason;
  logger.warn("[sidecarConnection] health 探測失敗", reason);
}

async function healthAnswers(): Promise<boolean> {
  // 逾時用 AbortController＋setTimeout（與 doFetch 一致）：sidecar 活著但 event loop 被卡住時，
  // 請求會一直掛著，不能讓探測永遠等下去
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_ENDPOINT}/health`, { signal: controller.signal });
    if (!response.ok) {
      noteProbeFailure(`HTTP ${response.status}`);
      return false;
    }
    const body = await response.json();
    // health 走統一的 ApiResponse 信封：{ success, data: { status } }
    if (body?.data?.status !== "ok") {
      noteProbeFailure("health 回應不是 ok");
      return false;
    }
    lastProbeError = null;
    return true;
  } catch (err) {
    noteProbeFailure(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function scheduleProbe(delayMs: number) {
  clearTimeout(probeTimer);
  if (running) probeTimer = setTimeout(() => void probe(), delayMs);
}

async function probe() {
  if (!running || probing || !gateOpen) return;
  probing = true;
  clearTimeout(probeTimer);
  try {
    const reachable = await healthAnswers();
    // 探測途中 Rust 可能已說 sidecar 結束（閘門關了）：遲到的 ok 不能把狀態改回連上
    if (!running || !gateOpen) return;
    if (reachable) {
      everReachable = true;
      missesWhileUp = 0;
      clearTimeout(graceTimer);
      setPhase("up");
    } else if (phase === "up" && ++missesWhileUp < MISSES_BEFORE_DOWN) {
      // 先不改狀態，馬上再探一次確認（下面排的是 FAST_PROBE_MS）
    } else if (everReachable || phase === "down") {
      setPhase("down");
    }
    // 還在 starting 就維持：啟動時間到了由 graceTimer 改成 down
    scheduleProbe(phase === "up" && missesWhileUp === 0 ? SLOW_PROBE_MS : FAST_PROBE_MS);
  } finally {
    probing = false;
  }
}

/**
 * 開始監測，回傳停止函式。由 AppStatusProvider 在 layout effect 裡呼叫：
 * 要比子元件的查詢（passive effect）先把 onlineManager 設成離線，查詢才不會先失敗一輪。
 */
export function startSidecarConnection(): () => void {
  running = true;
  generation += 1;
  everReachable = false;
  missesWhileUp = 0;
  lastProbeError = null;
  block = null;
  phase = "starting";
  onlineManager.setEventListener((setOnline) => {
    setQueriesOnline = setOnline;
    // onlineManager 沒有訂閱者時會拆掉 listener、重新訂閱時再跑一次這裡：
    // 依目前狀態設定，不能無條件設成離線（已連上的 app 會因此永遠暫停）
    setOnline(phase === "up");
    return () => {
      setQueriesOnline = null;
    };
  });
  clearTimeout(graceTimer);
  graceTimer = setTimeout(() => {
    if (phase === "starting") setPhase("down");
  }, STARTUP_GRACE_MS);
  if (isTauri()) {
    gateOpen = false;
    void connectToRust(generation);
  } else {
    gateOpen = true;
    void probe();
  }

  return () => {
    running = false;
    clearTimeout(probeTimer);
    clearTimeout(graceTimer);
    unlistenRust?.();
    unlistenRust = null;
    // 歸零但不通知（元件正在卸載）：下一次掛載的第一次 render 才不會讀到這一輪留下的 up
    phase = "starting";
    everReachable = false;
    missesWhileUp = 0;
    block = null;
    // 還原成 React Query 的預設：聽瀏覽器的 online/offline
    onlineManager.setEventListener((setOnline) => {
      const onOnline = () => setOnline(true);
      const onOffline = () => setOnline(false);
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
      return () => {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
      };
    });
    onlineManager.setOnline(true);
  };
}

/** API 請求連不上 sidecar 時呼叫：立刻重探，不等下一輪 */
export function reportSidecarUnreachable(): void {
  if (running && phase === "up") void probe();
}

/** 立刻探一次（使用者按「重試」時） */
export function probeSidecarNow(): void {
  void probe();
}

/** 目前的連線階段；只在 phase 變動時通知 */
export function getSidecarPhase(): SidecarPhase {
  return phase;
}

export function subscribeSidecarPhase(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSidecarPhase(): SidecarPhase {
  return useSyncExternalStore(subscribeSidecarPhase, getSidecarPhase);
}

/** Rust 回報的、探測不會好的原因；沒有就是 null */
export function getSidecarBlock(): SidecarBlock | null {
  return block;
}

export function useSidecarBlock(): SidecarBlock | null {
  return useSyncExternalStore(subscribeSidecarPhase, getSidecarBlock);
}

/** 這次開 app 以來是否連上過；只會在 phase 變成 up 的同時變成 true，所以沿用同一個訂閱 */
export function useSidecarEverUp(): boolean {
  return useSyncExternalStore(subscribeSidecarPhase, () => everReachable);
}
