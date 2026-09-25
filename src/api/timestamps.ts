/**
 * sidecar 回應裡不帶時區的「日期＋時間」一律當 UTC 讀。
 *
 * DB 存 naive UTC（utc_now()）。sidecar 輸出時已帶上時區（sidecar/schemas/time.py，
 * tests/test_api_timestamps_utc.py 守住），這裡是前端的雙保險：漏網的欄位若以不帶時區的
 * "2026-09-25T12:00:00" 出現，new Date() 會把它當成本地時間，台灣會讓「幾小時前」多 8 小時。
 * 只有日期的字串（"2026-09-25"）new Date() 本來就當 UTC，不動；已帶 Z 或 ±hh:mm 的也不動。
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
