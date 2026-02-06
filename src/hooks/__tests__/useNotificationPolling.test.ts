import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { SetStateAction } from "react";
import { useNotificationPolling } from "../useNotificationPolling";
import { Notification } from "../useNotifications";
import * as apiClient from "../../api/client";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    listTriggeredAlerts: vi.fn(),
  };
});

vi.mock("../../utils/notificationHelpers", () => ({
  alertsToNotifications: vi.fn(() => []),
  sortNotifications: vi.fn((n: Notification[]) => n),
  mergeNotifications: vi.fn((newN: Notification[]) => newN),
}));

describe("useNotificationPolling", () => {
  let mockSetNotifications: ReturnType<
    typeof vi.fn<(value: SetStateAction<Notification[]>) => void>
  >;
  let mockReadIdsRef: { current: Set<string> };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockSetNotifications = vi.fn<(value: SetStateAction<Notification[]>) => void>();
    mockReadIdsRef = { current: new Set<string>() };
    vi.mocked(apiClient.listTriggeredAlerts).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches notifications on mount", async () => {
    renderHook(() => useNotificationPolling(mockSetNotifications, mockReadIdsRef));

    await vi.advanceTimersByTimeAsync(0);

    expect(apiClient.listTriggeredAlerts).toHaveBeenCalledWith(false, 50);
  });

  it("starts in loading state and becomes false after fetch", async () => {
    const { result } = renderHook(() =>
      useNotificationPolling(mockSetNotifications, mockReadIdsRef)
    );

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.isLoading).toBe(false);
  });

  it("polls every 60 seconds", async () => {
    renderHook(() => useNotificationPolling(mockSetNotifications, mockReadIdsRef));

    await vi.advanceTimersByTimeAsync(0);
    expect(apiClient.listTriggeredAlerts).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60000);
    expect(apiClient.listTriggeredAlerts).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(60000);
    expect(apiClient.listTriggeredAlerts).toHaveBeenCalledTimes(3);
  });

  it("sets error on API failure", async () => {
    vi.mocked(apiClient.listTriggeredAlerts).mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() =>
      useNotificationPolling(mockSetNotifications, mockReadIdsRef)
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.error).toBe("Network error");
  });

  it("refresh triggers a new fetch", async () => {
    const { result } = renderHook(() =>
      useNotificationPolling(mockSetNotifications, mockReadIdsRef)
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(apiClient.listTriggeredAlerts).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });

    expect(apiClient.listTriggeredAlerts).toHaveBeenCalledTimes(2);
  });

  it("cleans up interval on unmount", async () => {
    const { unmount } = renderHook(() =>
      useNotificationPolling(mockSetNotifications, mockReadIdsRef)
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(apiClient.listTriggeredAlerts).toHaveBeenCalledTimes(1);

    unmount();

    await vi.advanceTimersByTimeAsync(60000);
    expect(apiClient.listTriggeredAlerts).toHaveBeenCalledTimes(1);
  });
});
