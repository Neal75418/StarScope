/**
 * 儀表板橫向長條圖的共用版面參數。
 *
 * 增長速度分佈與語言分佈並排在同一個 grid 列裡，列高必須一致——否則兩張
 * 圖的長條粗細與間距不同，並排看起來就像兩套設計。這裡放的是唯一一份算法，
 * 兩邊各留一份的話，改了一邊另一邊會無聲地跟著歪掉。
 */

/** 每一列（一個語言 / 一個速度分組）佔的高度 */
const ROW_HEIGHT = 26;

/** 座標軸刻度那一列的高度 */
const AXIS_HEIGHT = 24;

/** 資料很少時的下限，避免只有一兩列時圖表被壓扁 */
const MIN_HEIGHT = 120;

export function barChartMinHeight(rowCount: number): number {
  return Math.max(MIN_HEIGHT, rowCount * ROW_HEIGHT + AXIS_HEIGHT);
}
