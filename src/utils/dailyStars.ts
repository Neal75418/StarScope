/**
 * 把「組合總星數」的快照序列換算成「每日新增星數」。
 *
 * 原本的折線畫的是總星數：8.42M 的基數上，一週漲 106,473（1.28%）——
 * 實測折線的垂直跨度只有 1.3px，繪圖區有 126px，所以永遠是一條水平線。
 * 改看增量之後，Y 軸從 0 起算才是對的，變化也回到畫面上看得見的尺度。
 *
 * 兩個必須誠實處理的地方：
 *
 * 1. **量測有缺口。** 這是桌面 App，只有開著的時候才會抓快照，所以會出現
 *    8/16 → 8/18 這種隔兩天才量到一次的情形。把那次的差額整筆算在 8/18
 *    頭上，畫出來會是 17,733 → 35,916 → 49,379 的假暴衝；攤成日均之後
 *    是 17,733 → 17,958 → 16,460，才是真實的平穩。攤過的那幾天會標記
 *    起來，讓畫面說得出哪些是推估的。
 *
 * 2. **今天還沒過完。** 最後一筆快照是今天抓的，只涵蓋幾個小時，數字必然
 *    偏低。不標記的話每天最右邊那根都會看起來像崩盤。
 */

import type { PortfolioHistoryPoint } from "../api/types";

const MS_PER_DAY = 86_400_000;

export interface DailyStarBar {
  /** YYYY-MM-DD */
  date: string;
  /** 當天新增星數；跨越多天只量到一次時，這裡是那幾天的日均 */
  stars: number;
  /** 這個值是由幾天的量測攤出來的。1 = 當天實際量到 */
  spanDays: number;
  /** 這一天還沒過完，數字只到目前為止 */
  partial: boolean;
  /** 這段期間追蹤清單的 repo 數量有變動，取消追蹤會讓總數下降並混進這個數字 */
  membershipChanged: boolean;
}

export interface DailyStarsResult {
  bars: DailyStarBar[];
  /** 圖上實際涵蓋幾天，可能小於使用者選的範圍 */
  coverageDays: number;
  requestedDays: number;
  /** 期間總增加量。用頭尾相減而非長條加總，才不會被日均的四捨五入影響 */
  totalGained: number;
  /** 最後一筆快照當下追蹤幾個 repo */
  repoCount: number;
  hasEstimates: boolean;
  hasMembershipChange: boolean;
}

function parseUtcDate(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

function addDays(iso: string, n: number): string {
  return new Date(parseUtcDate(iso) + n * MS_PER_DAY).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((parseUtcDate(to) - parseUtcDate(from)) / MS_PER_DAY);
}

/**
 * @param history 後端回傳的快照序列，依日期遞增
 * @param requestedDays 使用者選的範圍（7 / 14 / 30）
 * @param today UTC 的今天（YYYY-MM-DD）。快照日期由後端以 UTC 產生，
 *              用本地日期比對會在跨日前後標錯「今天」
 */
export function computeDailyStars(
  history: PortfolioHistoryPoint[],
  requestedDays: number,
  today: string
): DailyStarsResult {
  const bars: DailyStarBar[] = [];

  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const cur = history[i];
    const spanDays = daysBetween(prev.date, cur.date);
    // 同一天有兩筆（或日期順序異常）時 spanDays 會是 0 或負數。下面的
    // offset <= spanDays 本來就不會跑，長條不會壞；這行只是把「這種輸入
    // 直接跳過」寫明，順便避免算出一個沒人用的 Infinity
    if (spanDays < 1) continue;

    const perDay = (cur.total_stars - prev.total_stars) / spanDays;
    const membershipChanged = prev.repo_count !== cur.repo_count;

    for (let offset = 1; offset <= spanDays; offset++) {
      const date = addDays(prev.date, offset);
      bars.push({
        date,
        stars: Math.round(perDay),
        spanDays,
        partial: date === today,
        membershipChanged,
      });
    }
  }

  const first = history[0];
  const last = history[history.length - 1];

  return {
    bars,
    coverageDays: bars.length,
    requestedDays,
    totalGained: history.length >= 2 ? last.total_stars - first.total_stars : 0,
    repoCount: last?.repo_count ?? 0,
    hasEstimates: bars.some((b) => b.spanDays > 1),
    hasMembershipChange: bars.some((b) => b.membershipChanged),
  };
}

/**
 * 算出「整齊」的 Y 軸刻度。
 *
 * 交給 Recharts 自動決定的話，最大值 17,958 會被切成 0 / 4,500 / 9,000 /
 * 13,500 / 18,000，標成 K 之後是 0 / 5K / 9K / 14K / 18K——間距看起來忽大忽小。
 * 這裡先把刻度單位收斂到 1／2／5 乘 10 的次方，再往外取整。
 */
function niceStep(range: number, targetTicks: number): number {
  if (range <= 0) return 1;
  const rough = range / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export function starAxisTicks(bars: DailyStarBar[], targetTicks = 4): number[] {
  const values = bars.map((b) => b.stars);
  // 一律包含 0：增量圖的基準線就是零，沒有它看不出正負
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const step = niceStep(max - min, targetTicks);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) {
    // 浮點累加會留下 1e-12 這種尾巴，讓刻度標成 "5.000000000001K"
    ticks.push(Math.round(v));
  }
  return ticks;
}
