/**
 * Shared formatting utilities for displaying numbers
 */

/**
 * Format a number for display (e.g., 1234 -> "1.2k")
 */
export function formatNumber(num: number | null): string {
  if (num === null) return "—";
  if (Math.abs(num) >= 1000) {
    return (num / 1000).toFixed(1) + "k";
  }
  // Show decimal only if needed
  return num % 1 === 0 ? num.toFixed(0) : num.toFixed(1);
}

/**
 * Format a delta with sign prefix (e.g., 100 -> "+100", -50 -> "-50")
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
 * Format velocity (stars per day)
 */
export function formatVelocity(num: number | null): string {
  if (num === null) return "—";
  return num.toFixed(1) + "/day";
}

/**
 * Format date string for chart axis labels (e.g., "2024-01-15" -> "1/15")
 */
export function formatChartDate(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
