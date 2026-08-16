/**
 * 「在動」面板的運算：選窗口、算相對成長、算顯著門檻。
 *
 * 為什麼用相對值：追蹤清單的星數跨度從 1k 到 40 萬，絕對增量無法比較——
 * 一個 20 萬星的 repo 一天多 100 顆是死水，5 千星的 repo 一天多 100 顆是爆發。
 */
import type { RepoWithSignals } from "../api/types";

export type MoverWindow = 1 | 7;

export interface Mover {
  repo: RepoWithSignals;
  delta: number;
  /** 相對於成長前星數的比例 */
  relative: number;
}

export interface MoversResult {
  /** null = 任何窗口都沒有資料 */
  window: MoverWindow | null;
  risers: Mover[];
  fallers: Mover[];
  /** 中位數 ×10。null = 中位數為 0，沒有東西稱得上顯著，不畫線 */
  threshold: number | null;
  totalDelta: number | null;
}

const MAX_RISERS = 5;
const THRESHOLD_MULTIPLIER = 10;

function deltaFor(repo: RepoWithSignals, window: MoverWindow): number | null {
  return window === 7 ? repo.stars_delta_7d : repo.stars_delta_1d;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * 取有資料的最寬窗。判定是比較涵蓋範圍而不是「有沒有任何一筆」——
 * 七日資料開始出現的那天，可能只有少數 repo 補齊，切過去會讓排行縮成幾列。
 */
function pickWindow(repos: RepoWithSignals[]): MoverWindow | null {
  const withSeven = repos.filter((r) => r.stars_delta_7d != null).length;
  const withOne = repos.filter((r) => r.stars_delta_1d != null).length;
  if (withSeven > 0 && withSeven >= withOne) return 7;
  if (withOne > 0) return 1;
  return null;
}

export function computeMovers(repos: RepoWithSignals[]): MoversResult {
  const window = pickWindow(repos);
  if (window === null) {
    return { window: null, risers: [], fallers: [], threshold: null, totalDelta: null };
  }

  const movers: Mover[] = [];
  let totalDelta = 0;

  for (const repo of repos) {
    const delta = deltaFor(repo, window);
    if (delta == null) continue;
    totalDelta += delta;

    // 基期為 0 的排除：從 0 漲到 5 是無限大成長，會永遠霸佔第一名
    const base = (repo.stars ?? 0) - delta;
    if (base <= 0) continue;
    movers.push({ repo, delta, relative: delta / base });
  }

  // 母體含零與負值。只取正成長子集會讓門檻隨「今天有幾個在漲」跳動，
  // 失去自我校準的意義。
  const med = median(movers.map((m) => m.relative).sort((a, b) => a - b));
  const threshold = med > 0 ? med * THRESHOLD_MULTIPLIER : null;

  const risers = movers
    .filter((m) => m.relative > 0)
    .sort((a, b) => b.relative - a.relative)
    .slice(0, MAX_RISERS);

  const fallers = movers.filter((m) => m.relative < 0).sort((a, b) => a.relative - b.relative);

  return { window, risers, fallers, threshold, totalDelta };
}
