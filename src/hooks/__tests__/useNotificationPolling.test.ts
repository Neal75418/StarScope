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
    // Restore document.hidden to default (tests may override it)
    Object.defineProperty(document, "hidden", { value: false, writable: true });
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

  it("pauses polling when page becomes hidden", async () => {
    renderHook(() => useNotificationPolling(mockSetNotifications, mockReadIdsRef));

    await vi.advanceTimersByTimeAsync(0);
    expect(apiClient.listTriggeredAlerts).toHaveBeenCalledTimes(1);

    // Simulate page becoming hidden
    Object.defineProperty(document, "hidden", { value: true, writable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    // Advance time past poll interval
    await vi.advanceTimersByTimeAsync(120000);
    // Should not have polled while hidden
    expect(apiClient.listTriggeredAlerts).toHaveBeenCalledTimes(1);

    // Restore visibility
    Object.defineProperty(document, "hidden", { value: false, writable: true });
  });

  it("resumes polling when page becomes visible again", async () => {
    renderHook(() => useNotificationPolling(mockSetNotifications, mockReadIdsRef));

    await vi.advanceTimersByTimeAsync(0);
    expect(apiClient.listTriggeredAlerts).toHaveBeenCalledTimes(1);

    // Go hidden
    Object.defineProperty(document, "hidden", { value: true, writable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    // Come back visible
    Object.defineProperty(document, "hidden", { value: false, writable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    await vi.advanceTimersByTimeAsync(0);
    // Should have fetched again on visibility restore
    expect(apiClient.listTriggeredAlerts).toHaveBeenCalledTimes(2);
  });

  it("handles non-Error exceptions in fetch", async () => {
    vi.mocked(apiClient.listTriggeredAlerts).mockRejectedValue("string error");

    const { result } = renderHook(() =>
      useNotificationPolling(mockSetNotifications, mockReadIdsRef)
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Non-Error exceptions produce a generic fallback message
    expect(result.current.error).toBeTruthy();
  });
});
