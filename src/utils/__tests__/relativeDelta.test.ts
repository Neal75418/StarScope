/**
 * 相對變化的算法與呈現。
 *
 * 數字取自 2026-08-22 的真實追蹤清單（94 個 repo）。
 */

import { describe, it, expect } from "vitest";
import { relativeDelta } from "../relativeDelta";
import { formatRelativeDelta } from "../format";

describe("relativeDelta", () => {
  it("以期初星數為分母，不是現在的星數", () => {
    // deepseek-harness：113,968 → 182,687，七天 +68,719。
    // 拿現在的 182,687 當分母會算出 37.6%，實際漲幅是 60.3%
    const r = relativeDelta(182687, 68719);

    expect(r).toBeCloseTo(68719 / 113968, 10);
    expect(((r ?? 0) * 100).toFixed(1)).toBe("60.3");
  });

  it("期初為零時回 null——從 0 漲到 5 是無限大，排序會被它霸佔", () => {
    expect(relativeDelta(5, 5)).toBeNull();
    expect(relativeDelta(3, 10)).toBeNull();
  });

  it("沒有增量資料時回 null，不當成零", () => {
    expect(relativeDelta(1000, null)).toBeNull();
    expect(relativeDelta(1000, undefined)).toBeNull();
  });

  it("負成長給負值", () => {
    // pathwaycom/pathway：七天 -58，現在 62.4K
    expect(relativeDelta(62400, -58)).toBeLessThan(0);
  });

  it("零變化是零，不是 null——量到了而且沒動，跟量不到是兩回事", () => {
    expect(relativeDelta(1000, 0)).toBe(0);
  });
});

describe("formatRelativeDelta", () => {
  it("非零的值不會顯示成零", () => {
    // eugenp/tutorials：+1 顆星、期初 37,324 → 0.00268%
    expect(formatRelativeDelta(1 / 37324)).toBe("+0.003%");
  });

  it("大幅變化只留一位小數", () => {
    expect(formatRelativeDelta(68719 / 113968)).toBe("+60.3%");
  });

  it("一般幅度留兩位小數", () => {
    expect(formatRelativeDelta(26 / 38811)).toBe("+0.07%");
  });

  it("負值帶負號、不帶正號", () => {
    expect(formatRelativeDelta(-58 / 62458)).toMatch(/^-/);
  });

  it("零不加正號——零沒有方向", () => {
    expect(formatRelativeDelta(0)).toBe("0.00%");
  });

  it("null 顯示破折號，跟 formatDelta 一致", () => {
    expect(formatRelativeDelta(null)).toBe("—");
  });
});
