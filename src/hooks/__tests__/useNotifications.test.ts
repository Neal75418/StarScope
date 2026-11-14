import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { DATA_RESET_EVENT } from "../../constants/events";
import type { Dispatch, SetStateAction } from "react";
import type { Notification } from "../useNotifications";

// Capture setNotifications so we can inject notifications from outside
let capturedSetNotifications: Dispatch<SetStateAction<Notification[]>> | null = null;

// Mock all sub-hooks
vi.mock("../useNotificationStorage", () => ({
  useNotificationStorage: () => ({
    readIdsRef: { current: new Set<string>() },
    markIdAsRead: vi.fn(),
    markIdsAsRead: vi.fn(),
    removeIdFromRead: vi.fn(),
    clearAll: vi.fn(),
  }),
}));

const idlePolling = {
  isLoading: false,
  error: null as string | null,
  loadFailed: false,
  loadInProgress: false,
  refresh: vi.fn(),
};
let pollingResult = idlePolling;

vi.mock("../useNotificationPolling", () => ({
  useNotificationPolling: (setNotifications: Dispatch<SetStateAction<Notification[]>>) => {
    capturedSetNotifications = setNotifications;
    return pollingResult;
  },
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
    pollingResult = idlePolling;
  });

  it("passes the load state and the retry of the polling query through", () => {
    // 通知中心的「讀不到＋重試」靠這幾個欄位；元件測試把這支 hook 整個 mock 掉，接線要在這裡守
    const refresh = vi.fn();
    pollingResult = {
      isLoading: true,
      error: "HTTP 500",
      loadFailed: true,
      loadInProgress: true,
      refresh,
    };

    const { result } = renderHook(() => useNotifications());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBe("HTTP 500");
    expect(result.current.loadFailed).toBe(true);
    expect(result.current.loadInProgress).toBe(true);
    expect(result.current.refresh).toBe(refresh);
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

  it("clears notifications on data-reset event", () => {
    const { result } = renderHook(() => useNotifications());

    // Inject notifications via captured setter
    act(() => {
      capturedSetNotifications?.([
        {
          id: "n1",
          type: "alert",
          title: "Test",
          message: "msg",
          timestamp: "2024-01-01",
          read: false,
        },
      ]);
    });
    expect(result.current.notifications).toHaveLength(1);

    // Dispatch reset event
    act(() => {
      window.dispatchEvent(new Event(DATA_RESET_EVENT));
    });

    expect(result.current.notifications).toHaveLength(0);
    expect(result.current.unreadCount).toBe(0);
  });
});
