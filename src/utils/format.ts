/**
 * 數字與時間的共用格式化工具。
 */

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

/**
 * 格式化數字以供顯示（例如 1234 -> "1.2K"、1234567 -> "1.2M"）。
 */
export function formatNumber(num: number | null): string {
  if (num === null) return "—";
  if (Math.abs(num) >= 1_000_000) {
    return (num / 1_000_000).toFixed(1) + "M";
  }
  if (Math.abs(num) >= 1000) {
    return (num / 1000).toFixed(1) + "K";
  }
  return num % 1 === 0 ? num.toFixed(0) : num.toFixed(1);
}

/**
 * 格式化差值並加上正負號前綴（例如 100 -> "+100"、-50 -> "-50"）。
 */
export function formatDelta(num: number | null): string {
  if (num === null) return "—";
  const sign = num >= 0 ? "+" : "";
  if (Math.abs(num) >= 1_000_000) {
    return sign + (num / 1_000_000).toFixed(1) + "M";
  }
  if (Math.abs(num) >= 1000) {
    return sign + (num / 1000).toFixed(1) + "K";
  }
  return sign + num.toFixed(0);
}

/**
 * 格式化時間戳為緊湊的相對時間（例如 "3h"、"2d"）。
 * 用於 Dashboard 訊號與活動列表。
 */
export function formatCompactRelativeTime(timestamp: string, justNowText: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / MS_PER_HOUR);
  const diffDays = Math.floor(diffMs / MS_PER_DAY);

  if (diffHours < 1) return justNowText;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString();
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
