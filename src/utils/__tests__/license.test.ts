/**
 * GitHub 的 spdx_id 有兩個不是授權名稱的哨兵值。
 *
 * 2026-08-23 實測：搜尋「rust game engine」的 30 筆結果裡，26 個有授權的
 * 當中 4 個是 NOASSERTION（15%），畫面上直接印出這個字串。
 */

import { describe, it, expect } from "vitest";
import { isLicenseSentinel } from "../license";

describe("isLicenseSentinel", () => {
  it("NOASSERTION 是哨兵值，不是授權名稱", () => {
    expect(isLicenseSentinel("NOASSERTION")).toBe(true);
  });

  it("NONE 也是——完全沒有授權檔時 GitHub 回這個", () => {
    expect(isLicenseSentinel("NONE")).toBe(true);
  });

  it("真正的授權識別碼原樣顯示——SPDX id 是開發者看得懂的標準寫法", () => {
    for (const spdx of ["MIT", "Apache-2.0", "GPL-3.0", "BSD-3-Clause", "Unlicense"]) {
      expect(isLicenseSentinel(spdx)).toBe(false);
    }
  });

  it("大小寫不影響判斷", () => {
    expect(isLicenseSentinel("noassertion")).toBe(true);
  });

  it("null 與 undefined 不算哨兵值——那是「沒有這個欄位」，呼叫端本來就不會渲染", () => {
    expect(isLicenseSentinel(null)).toBe(false);
    expect(isLicenseSentinel(undefined)).toBe(false);
  });
});
