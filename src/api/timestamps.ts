/**
 * sidecar 回應裡的時間一律補成 UTC。
 *
 * DB 存 naive UTC（utc_now()），序列化出來是不帶時區的 "2026-09-25T12:00:00"；
 * new Date() 會把不帶時區的「日期＋時間」當成本地時間，台灣會讓每個「幾小時前」多 8 小時。
 * 只有日期的字串（"2026-09-25"）new Date() 本來就當 UTC，不動；已帶 Z 或 ±hh:mm 的也不動。
 * 在 client 這一個關口處理，前端各處不必各自記得補。
 */

const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

export function normalizeApiTimestamps<T>(value: T): T {
  if (typeof value === "string") {
    return (NAIVE_DATETIME.test(value) ? `${value}Z` : value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeApiTimestamps(item)) as T;
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeApiTimestamps(item)])
    ) as T;
  }
  return value;
}
