import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCollapsible } from "../useCollapsible";

const TEST_KEY = "test-collapsible";

describe("useCollapsible", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to not collapsed", () => {
    const { result } = renderHook(() => useCollapsible(TEST_KEY));
    expect(result.current.collapsed).toBe(false);
  });

  it("uses defaultCollapsed parameter", () => {
    const { result } = renderHook(() => useCollapsible(TEST_KEY, true));
    expect(result.current.collapsed).toBe(true);
  });

  it("toggles state", () => {
    const { result } = renderHook(() => useCollapsible(TEST_KEY));

    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);

    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(false);
  });

  it("persists to localStorage", () => {
    const { result } = renderHook(() => useCollapsible(TEST_KEY));

    act(() => result.current.toggle());
    expect(localStorage.getItem(TEST_KEY)).toBe("true");
  });

  it("restores from localStorage", () => {
    localStorage.setItem(TEST_KEY, "true");

    const { result } = renderHook(() => useCollapsible(TEST_KEY));
    expect(result.current.collapsed).toBe(true);
  });
});
