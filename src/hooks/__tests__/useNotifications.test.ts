import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock all sub-hooks
vi.mock("../useNotificationStorage", () => ({
  useNotificationStorage: () => ({
    readIdsRef: { current: new Set<string>() },
    markIdAsRead: vi.fn(),
    markIdsAsRead: vi.fn(),
  }),
}));

vi.mock("../useNotificationPolling", () => ({
  useNotificationPolling: () => ({
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock("../useNotificationActions", () => ({
  useNotificationActions: () => ({
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
    clearNotification: vi.fn(),
  }),
}));

vi.mock("../useOSNotification", () => ({
  useOSNotification: () => ({
    isGranted: false,
    isLoading: false,
    requestNotificationPermission: vi.fn(),
    sendNotification: vi.fn(),
  }),
}));

import { useNotifications } from "../useNotifications";

describe("useNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts with isOpen false", () => {
    const { result } = renderHook(() => useNotifications());
    expect(result.current.isOpen).toBe(false);
  });

  it("toggleOpen toggles isOpen state", () => {
    const { result } = renderHook(() => useNotifications());
    act(() => {
      result.current.toggleOpen();
    });
    expect(result.current.isOpen).toBe(true);
    act(() => {
      result.current.toggleOpen();
    });
    expect(result.current.isOpen).toBe(false);
  });

  it("close sets isOpen to false", () => {
    const { result } = renderHook(() => useNotifications());
    act(() => {
      result.current.toggleOpen();
    });
    expect(result.current.isOpen).toBe(true);
    act(() => {
      result.current.close();
    });
    expect(result.current.isOpen).toBe(false);
  });

  it("starts with empty notifications and zero unread count", () => {
    const { result } = renderHook(() => useNotifications());
    expect(result.current.notifications).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
  });

  it("exposes osNotification properties", () => {
    const { result } = renderHook(() => useNotifications());
    expect(result.current.osNotification).toHaveProperty("isGranted");
    expect(result.current.osNotification).toHaveProperty("isLoading");
    expect(result.current.osNotification).toHaveProperty("requestPermission");
  });
});
