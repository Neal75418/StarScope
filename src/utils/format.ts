/**
 * 數字顯示的共用格式化工具。
 */

/**
 * 格式化數字以供顯示（例如 1234 -> "1.2k"）。
 */
export function formatNumber(num: number | null): string {
  if (num === null) return "—";
  if (Math.abs(num) >= 1000) {
    return (num / 1000).toFixed(1) + "k";
  }
  // 僅在需要時顯示小數
  return num % 1 === 0 ? num.toFixed(0) : num.toFixed(1);
}

/**
 * 格式化差值並加上正負號前綴（例如 100 -> "+100"、-50 -> "-50"）。
 */
export function formatDelta(num: number | null): string {
  if (num === null) return "—";
  const sign = num >= 0 ? "+" : "";
  if (Math.abs(num) >= 1000) {
    return sign + (num / 1000).toFixed(1) + "k";
  }
  return sign + num.toFixed(0);
}

/**
 * 格式化增長速度（每日星數）。
 */
export function formatVelocity(num: number | null): string {
  if (num === null) return "—";
  return num.toFixed(1) + "/day";
}

/**
 * 格式化日期字串供圖表座標軸標籤使用（例如 "2024-01-15" -> "1/15"）。
 */
export function formatChartDate(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
