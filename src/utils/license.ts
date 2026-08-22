/**
 * GitHub 授權識別碼的顯示處理。
 *
 * `license.spdx_id` 有兩個不是授權名稱的哨兵值，直接印出來會把 API 的內部
 * 表示法漏給使用者看：
 *
 * - `NOASSERTION`：有 LICENSE 檔，但 GitHub 的 licensee 辨識不出是哪一種。
 *   **不等於沒有授權**——所以不能靠隱藏徽章來處理，那會傳達相反的訊息。
 * - `NONE`：完全沒有授權檔。
 *
 * 其餘一律原樣顯示：SPDX id（`MIT`、`Apache-2.0`）是開發者工具的標準寫法，
 * 換成篩選下拉那套友善名（`Apache 2.0`）並不會更好懂。
 *
 * 2026-08-23 實測：搜尋「rust game engine」的 30 筆結果裡，26 個有授權的
 * 當中有 4 個是 NOASSERTION（15%），不是罕見邊角。
 */

const SENTINELS = new Set(["NOASSERTION", "NONE"]);

export function isLicenseSentinel(spdx: string | null | undefined): boolean {
  return spdx != null && SENTINELS.has(spdx.toUpperCase());
}
