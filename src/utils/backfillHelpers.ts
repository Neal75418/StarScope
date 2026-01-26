import { ApiError } from "../api/client";

// Check if error is a network error
export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError && err.message === "Failed to fetch") {
    return true;
  }
  return err instanceof ApiError && (err.status === 0 || err.status >= 500);
}

// 格式化相對時間
export function formatRelativeTime(date: Date | null, justNowText: string): string {
  if (!date) return "";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return justNowText;
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
