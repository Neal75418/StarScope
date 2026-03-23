/**
 * useSmartInterval 的測試。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSmartInterval } from "../useSmartInterval";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Mock useOnlineStatus
let mockOnline = true;
vi.mock("../useOnlineStatus", () => ({
  useOnlineStatus: () => mockOnline,
}));

describe("useSmartInterval", () => {
  const originalHidden = document.hidden;

  beforeEach(() => {
    mockOnline = true;
    Object.defineProperty(document, "hidden", { value: false, writable: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(document, "hidden", {
      value: originalHidden,
      writable: true,
      configurable: true,
    });
  });

  it("returns interval when online and visible", () => {
    const { result } = renderHook(() => useSmartInterval(60_000));
    expect(result.current()).toBe(60_000);
  });

  it("returns false when document is hidden", () => {
    Object.defineProperty(document, "hidden", { value: true, writable: true, configurable: true });
    const { result } = renderHook(() => useSmartInterval(60_000));
    expect(result.current()).toBe(false);
  });

  it("returns false when offline", () => {
    mockOnline = false;
    const { result } = renderHook(() => useSmartInterval(60_000));
    expect(result.current()).toBe(false);
  });

  it("returns stable function reference", () => {
    const { result, rerender } = renderHook(() => useSmartInterval(60_000));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
