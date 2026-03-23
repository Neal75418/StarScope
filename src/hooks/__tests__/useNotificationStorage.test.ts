import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNotificationStorage } from "../useNotificationStorage";

describe("useNotificationStorage", () => {
  let storageData: Record<string, string>;

  beforeEach(() => {
    storageData = {};
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(
      (key: string) => storageData[key] ?? null
    );
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key: string, value: string) => {
      storageData[key] = value;
    });
  });

  it("starts with empty read IDs when no stored data", () => {
    const { result } = renderHook(() => useNotificationStorage());
    expect(result.current.readIdsRef.current.size).toBe(0);
  });

  it("loads existing read IDs from localStorage", () => {
    storageData["starscope_notifications_read"] = JSON.stringify(["id-1", "id-2"]);
    const { result } = renderHook(() => useNotificationStorage());
    expect(result.current.readIdsRef.current.has("id-1")).toBe(true);
    expect(result.current.readIdsRef.current.has("id-2")).toBe(true);
  });

  it("markIdAsRead adds ID and persists to localStorage", () => {
    const { result } = renderHook(() => useNotificationStorage());
    act(() => {
      result.current.markIdAsRead("notif-42");
    });
    expect(result.current.readIdsRef.current.has("notif-42")).toBe(true);
    const stored = JSON.parse(storageData["starscope_notifications_read"]) as string[];
    expect(stored).toContain("notif-42");
  });

  it("markIdsAsRead adds multiple IDs and persists", () => {
    const { result } = renderHook(() => useNotificationStorage());
    act(() => {
      result.current.markIdsAsRead(["a", "b", "c"]);
    });
    expect(result.current.readIdsRef.current.has("a")).toBe(true);
    expect(result.current.readIdsRef.current.has("b")).toBe(true);
    expect(result.current.readIdsRef.current.has("c")).toBe(true);
    const stored = JSON.parse(storageData["starscope_notifications_read"]) as string[];
    expect(stored).toEqual(expect.arrayContaining(["a", "b", "c"]));
  });

  it("removeIdFromRead removes ID from memory and localStorage", () => {
    storageData["starscope_notifications_read"] = JSON.stringify(["id-1", "id-2"]);
    const { result } = renderHook(() => useNotificationStorage());
    act(() => {
      result.current.removeIdFromRead("id-1");
    });
    expect(result.current.readIdsRef.current.has("id-1")).toBe(false);
    expect(result.current.readIdsRef.current.has("id-2")).toBe(true);
    const stored = JSON.parse(storageData["starscope_notifications_read"]) as string[];
    expect(stored).not.toContain("id-1");
    expect(stored).toContain("id-2");
  });

  it("handles corrupted localStorage data gracefully", () => {
    storageData["starscope_notifications_read"] = "not valid json!!!";
    const { result } = renderHook(() => useNotificationStorage());
    expect(result.current.readIdsRef.current.size).toBe(0);
  });

  it("handles localStorage setItem error gracefully", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const { result } = renderHook(() => useNotificationStorage());
    // Should not throw
    act(() => {
      result.current.markIdAsRead("test-id");
    });
    // ID is still added to in-memory set
    expect(result.current.readIdsRef.current.has("test-id")).toBe(true);
  });
});
