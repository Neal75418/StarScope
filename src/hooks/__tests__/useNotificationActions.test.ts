import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { SetStateAction } from "react";
import { useNotificationActions } from "../useNotificationActions";
import { Notification } from "../useNotifications";
import * as apiClient from "../../api/client";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    acknowledgeTriggeredAlert: vi.fn(),
  };
});

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "notif-1",
    type: "alert",
    title: "Star spike",
    message: "facebook/react velocity > 30",
    timestamp: "2024-01-20T00:00:00Z",
    read: false,
    metadata: { alertId: 42 },
    ...overrides,
  };
}

describe("useNotificationActions", () => {
  let mockSetNotifications: ReturnType<
    typeof vi.fn<(value: SetStateAction<Notification[]>) => void>
  >;
  let mockStorage: {
    markIdAsRead: ReturnType<typeof vi.fn<(id: string) => void>>;
    markIdsAsRead: ReturnType<typeof vi.fn<(ids: string[]) => void>>;
    removeIdFromRead: ReturnType<typeof vi.fn<(id: string) => void>>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSetNotifications = vi.fn<(value: SetStateAction<Notification[]>) => void>();
    mockStorage = {
      markIdAsRead: vi.fn<(id: string) => void>(),
      markIdsAsRead: vi.fn<(ids: string[]) => void>(),
      removeIdFromRead: vi.fn<(id: string) => void>(),
    };
    vi.mocked(apiClient.acknowledgeTriggeredAlert).mockResolvedValue({ status: "ok", id: 42 });
  });

  it("markAsRead updates notification state and storage", async () => {
    const notifications = [makeNotification()];
    const { result } = renderHook(() =>
      useNotificationActions(notifications, mockSetNotifications, mockStorage)
    );

    await act(async () => {
      await result.current.markAsRead("notif-1");
    });

    expect(mockStorage.markIdAsRead).toHaveBeenCalledWith("notif-1");
    expect(mockSetNotifications).toHaveBeenCalled();
  });

  it("markAsRead acknowledges alert on server for alert-type notifications", async () => {
    const notifications = [makeNotification({ type: "alert", metadata: { alertId: 42 } })];
    const { result } = renderHook(() =>
      useNotificationActions(notifications, mockSetNotifications, mockStorage)
    );

    await act(async () => {
      await result.current.markAsRead("notif-1");
    });

    expect(apiClient.acknowledgeTriggeredAlert).toHaveBeenCalledWith(42);
  });

  it("markAsRead does not call server for non-alert notifications", async () => {
    const notifications = [makeNotification({ type: "system", metadata: undefined })];
    const { result } = renderHook(() =>
      useNotificationActions(notifications, mockSetNotifications, mockStorage)
    );

    await act(async () => {
      await result.current.markAsRead("notif-1");
    });

    expect(apiClient.acknowledgeTriggeredAlert).not.toHaveBeenCalled();
  });

  it("markAllAsRead marks all notifications and acknowledges alerts", async () => {
    const notifications = [
      makeNotification({ id: "notif-1", type: "alert", metadata: { alertId: 42 }, read: false }),
      makeNotification({ id: "notif-2", type: "alert", metadata: { alertId: 43 }, read: false }),
      makeNotification({ id: "notif-3", type: "system", read: true }),
    ];
    const { result } = renderHook(() =>
      useNotificationActions(notifications, mockSetNotifications, mockStorage)
    );

    await act(async () => {
      await result.current.markAllAsRead();
    });

    // Only succeeded alert IDs + non-alert IDs should be persisted
    expect(mockStorage.markIdsAsRead).toHaveBeenCalledWith(["notif-1", "notif-2"]);
    expect(mockSetNotifications).toHaveBeenCalled();
    expect(apiClient.acknowledgeTriggeredAlert).toHaveBeenCalledWith(42);
    expect(apiClient.acknowledgeTriggeredAlert).toHaveBeenCalledWith(43);
  });

  it("clearNotification removes notification and marks as read in storage", async () => {
    const notifications = [makeNotification()];
    const { result } = renderHook(() =>
      useNotificationActions(notifications, mockSetNotifications, mockStorage)
    );

    await act(async () => {
      await result.current.clearNotification("notif-1");
    });

    expect(mockStorage.markIdAsRead).toHaveBeenCalledWith("notif-1");
    expect(mockSetNotifications).toHaveBeenCalled();
  });

  // --- Rollback behavior tests ---

  it("markAsRead rolls back UI and skips storage on alert ack failure", async () => {
    vi.mocked(apiClient.acknowledgeTriggeredAlert).mockRejectedValue(new Error("Server error"));
    const notifications = [makeNotification({ type: "alert", metadata: { alertId: 42 } })];
    const { result } = renderHook(() =>
      useNotificationActions(notifications, mockSetNotifications, mockStorage)
    );

    await act(async () => {
      await result.current.markAsRead("notif-1");
    });

    // Should NOT persist to storage on failure
    expect(mockStorage.markIdAsRead).not.toHaveBeenCalled();
    // Should have called setNotifications twice: optimistic + rollback
    expect(mockSetNotifications).toHaveBeenCalledTimes(2);
  });

  it("markAllAsRead reverts failed alerts and only persists succeeded ones", async () => {
    vi.mocked(apiClient.acknowledgeTriggeredAlert)
      .mockResolvedValueOnce({ status: "ok", id: 42 })
      .mockRejectedValueOnce(new Error("Server error"));

    const notifications = [
      makeNotification({ id: "notif-1", type: "alert", metadata: { alertId: 42 }, read: false }),
      makeNotification({ id: "notif-2", type: "alert", metadata: { alertId: 43 }, read: false }),
      makeNotification({ id: "notif-3", type: "system", metadata: undefined, read: false }),
    ];
    const { result } = renderHook(() =>
      useNotificationActions(notifications, mockSetNotifications, mockStorage)
    );

    await act(async () => {
      await result.current.markAllAsRead();
    });

    // Non-alert IDs persisted immediately
    expect(mockStorage.markIdsAsRead).toHaveBeenCalledWith(["notif-3"]);
    // Only the succeeded alert is persisted
    expect(mockStorage.markIdsAsRead).toHaveBeenCalledWith(["notif-1"]);
    // Failed alert UI should be reverted (setNotifications called for optimistic + revert)
    // Exactly 2 calls: optimistic mark-all-read + revert failed alert
    expect(mockSetNotifications).toHaveBeenCalledTimes(2);
  });

  it("clearNotification removes read mark from storage on alert ack failure", async () => {
    vi.mocked(apiClient.acknowledgeTriggeredAlert).mockRejectedValue(new Error("Server error"));
    const notifications = [makeNotification({ type: "alert", metadata: { alertId: 42 } })];
    const { result } = renderHook(() =>
      useNotificationActions(notifications, mockSetNotifications, mockStorage)
    );

    await act(async () => {
      await result.current.clearNotification("notif-1");
    });

    // Storage was marked as read optimistically
    expect(mockStorage.markIdAsRead).toHaveBeenCalledWith("notif-1");
    // But then rolled back on failure
    expect(mockStorage.removeIdFromRead).toHaveBeenCalledWith("notif-1");
  });

  it("clearNotification does not roll back storage for non-alert notifications", async () => {
    const notifications = [makeNotification({ type: "system", metadata: undefined })];
    const { result } = renderHook(() =>
      useNotificationActions(notifications, mockSetNotifications, mockStorage)
    );

    await act(async () => {
      await result.current.clearNotification("notif-1");
    });

    expect(mockStorage.markIdAsRead).toHaveBeenCalledWith("notif-1");
    expect(mockStorage.removeIdFromRead).not.toHaveBeenCalled();
    expect(apiClient.acknowledgeTriggeredAlert).not.toHaveBeenCalled();
  });
});
