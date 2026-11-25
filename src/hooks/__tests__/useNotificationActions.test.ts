import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState } from "react";
import type { SetStateAction } from "react";
import { useNotificationActions } from "../useNotificationActions";
import type { Notification } from "../useNotifications";
import * as apiClient from "../../api/client";
import { ApiError } from "../../api/types";
import {
  API_ERROR_MESSAGES,
  BATCH_ADD_FOLLOWUP_INTERVAL_MS,
  BATCH_ADD_TIMEOUT_MS,
} from "../../constants/api";
import { interpolate } from "../../i18n";
import { translations } from "../../i18n/translations";

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

function makeFeedback() {
  return {
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
    refresh: vi.fn(() => Promise.resolve()),
  };
}

const copy = translations.en.notifications.failed;
const gone = () => new ApiError(404, "Alert not found", "TRIGGERED_ALERT_NOT_FOUND");
const unreachable = () =>
  new ApiError(0, `${API_ERROR_MESSAGES.NETWORK_ERROR}: connection refused`);
const timedOut = () => new ApiError(0, API_ERROR_MESSAGES.TIMED_OUT);
const withCause = (outcome: string, cause: string) =>
  interpolate(translations.en.failure.withCause, { outcome, cause });

describe("useNotificationActions", () => {
  let mockSetNotifications: ReturnType<
    typeof vi.fn<(value: SetStateAction<Notification[]>) => void>
  >;
  let mockStorage: {
    markIdAsRead: ReturnType<typeof vi.fn<(id: string) => void>>;
    markIdsAsRead: ReturnType<typeof vi.fn<(ids: string[]) => void>>;
    removeIdFromRead: ReturnType<typeof vi.fn<(id: string) => void>>;
  };
  let mockFeedback: ReturnType<typeof makeFeedback>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSetNotifications = vi.fn<(value: SetStateAction<Notification[]>) => void>();
    mockStorage = {
      markIdAsRead: vi.fn<(id: string) => void>(),
      markIdsAsRead: vi.fn<(ids: string[]) => void>(),
      removeIdFromRead: vi.fn<(id: string) => void>(),
    };
    mockFeedback = makeFeedback();
    vi.mocked(apiClient.acknowledgeTriggeredAlert).mockResolvedValue({ status: "ok", id: 42 });
  });

  it("markAsRead updates notification state and storage", async () => {
    const notifications = [makeNotification()];
    const { result } = renderHook(() =>
      useNotificationActions(notifications, mockSetNotifications, mockStorage, mockFeedback)
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
      useNotificationActions(notifications, mockSetNotifications, mockStorage, mockFeedback)
    );

    await act(async () => {
      await result.current.markAsRead("notif-1");
    });

    expect(apiClient.acknowledgeTriggeredAlert).toHaveBeenCalledWith(42);
  });

  it("markAsRead does not call server for non-alert notifications", async () => {
    const notifications = [makeNotification({ type: "system", metadata: undefined })];
    const { result } = renderHook(() =>
      useNotificationActions(notifications, mockSetNotifications, mockStorage, mockFeedback)
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
      makeNotification({ id: "notif-3", type: "system", metadata: undefined, read: false }),
    ];
    const { result } = renderHook(() =>
      useNotificationActions(notifications, mockSetNotifications, mockStorage, mockFeedback)
    );

    await act(async () => {
      await result.current.markAllAsRead();
    });

    // Non-alert IDs should be persisted directly (no server ack needed)
    expect(mockStorage.markIdsAsRead).toHaveBeenCalledWith(["notif-3"]);
    // Succeeded alert IDs should also be persisted
    expect(mockStorage.markIdsAsRead).toHaveBeenCalledWith(["notif-1", "notif-2"]);
    expect(mockSetNotifications).toHaveBeenCalled();
    expect(apiClient.acknowledgeTriggeredAlert).toHaveBeenCalledWith(42);
    expect(apiClient.acknowledgeTriggeredAlert).toHaveBeenCalledWith(43);
  });

  it("clearNotification removes notification and marks as read in storage", async () => {
    const notifications = [makeNotification()];
    const { result } = renderHook(() =>
      useNotificationActions(notifications, mockSetNotifications, mockStorage, mockFeedback)
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
    const notifications = [
      makeNotification({ type: "alert", metadata: { alertId: 42 }, read: false }),
    ];
    const { result } = renderHook(() =>
      useNotificationActions(notifications, mockSetNotifications, mockStorage, mockFeedback)
    );

    await act(async () => {
      await result.current.markAsRead("notif-1");
    });

    // Should NOT persist to storage on failure
    expect(mockStorage.markIdAsRead).not.toHaveBeenCalled();
    // Should have called setNotifications twice: optimistic + rollback
    expect(mockSetNotifications).toHaveBeenCalledTimes(2);

    // Verify optimistic update set read: true
    const optimisticUpdater = mockSetNotifications.mock.calls[0][0] as (
      prev: typeof notifications
    ) => typeof notifications;
    const optimisticResult = optimisticUpdater(notifications);
    expect(optimisticResult[0].read).toBe(true);

    // Verify rollback restored read: false
    const rollbackUpdater = mockSetNotifications.mock.calls[1][0] as (
      prev: typeof notifications
    ) => typeof notifications;
    const rollbackResult = rollbackUpdater(optimisticResult);
    expect(rollbackResult[0].read).toBe(false);
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
      useNotificationActions(notifications, mockSetNotifications, mockStorage, mockFeedback)
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

    // Verify rollback: notif-2 (failed) should be reverted to read:false, notif-1 (succeeded) stays read:true
    const revertUpdater = mockSetNotifications.mock.calls[1][0] as (
      prev: Notification[]
    ) => Notification[];
    const allMarkedRead = notifications.map((n) => ({ ...n, read: true }));
    const reverted = revertUpdater(allMarkedRead);
    expect(reverted.find((n) => n.id === "notif-2")?.read).toBe(false);
    expect(reverted.find((n) => n.id === "notif-1")?.read).toBe(true);
  });

  it("clearNotification removes read mark from storage on alert ack failure", async () => {
    vi.mocked(apiClient.acknowledgeTriggeredAlert).mockRejectedValue(new Error("Server error"));
    const notifications = [makeNotification({ type: "alert", metadata: { alertId: 42 } })];
    const { result } = renderHook(() =>
      useNotificationActions(notifications, mockSetNotifications, mockStorage, mockFeedback)
    );

    await act(async () => {
      await result.current.clearNotification("notif-1");
    });

    // Storage was marked as read optimistically
    expect(mockStorage.markIdAsRead).toHaveBeenCalledWith("notif-1");
    // But then rolled back on failure
    expect(mockStorage.removeIdFromRead).toHaveBeenCalledWith("notif-1");
  });

  it("clearNotification restores notification to list on alert ack failure", async () => {
    vi.mocked(apiClient.acknowledgeTriggeredAlert).mockRejectedValue(new Error("Server error"));
    const notification = makeNotification({
      type: "alert",
      metadata: { alertId: 42 },
      read: false,
    });
    const notifications = [notification];
    const { result } = renderHook(() =>
      useNotificationActions(notifications, mockSetNotifications, mockStorage, mockFeedback)
    );

    await act(async () => {
      await result.current.clearNotification("notif-1");
    });

    // setNotifications should be called at least twice: optimistic removal + restore
    expect(mockSetNotifications.mock.calls.length).toBeGreaterThanOrEqual(2);

    // Verify the restore updater re-adds the notification
    const restoreUpdater = mockSetNotifications.mock.calls[
      mockSetNotifications.mock.calls.length - 1
    ][0] as (prev: Notification[]) => Notification[];
    const restored = restoreUpdater([]); // empty list = not yet re-added by poll
    expect(restored).toHaveLength(1);
    expect(restored[0].id).toBe("notif-1");
    expect(restored[0].read).toBe(false);
  });

  it("clearNotification restore is idempotent if poll already re-added", async () => {
    vi.mocked(apiClient.acknowledgeTriggeredAlert).mockRejectedValue(new Error("Server error"));
    const notification = makeNotification({
      type: "alert",
      metadata: { alertId: 42 },
      read: false,
    });
    const notifications = [notification];
    const { result } = renderHook(() =>
      useNotificationActions(notifications, mockSetNotifications, mockStorage, mockFeedback)
    );

    await act(async () => {
      await result.current.clearNotification("notif-1");
    });

    // Verify restore doesn't duplicate if notification already present
    const restoreUpdater = mockSetNotifications.mock.calls[
      mockSetNotifications.mock.calls.length - 1
    ][0] as (prev: Notification[]) => Notification[];
    const alreadyPresent = [notification];
    const result2 = restoreUpdater(alreadyPresent);
    expect(result2).toHaveLength(1); // no duplicate
  });

  it("clearNotification does not roll back storage for non-alert notifications", async () => {
    const notifications = [makeNotification({ type: "system", metadata: undefined })];
    const { result } = renderHook(() =>
      useNotificationActions(notifications, mockSetNotifications, mockStorage, mockFeedback)
    );

    await act(async () => {
      await result.current.clearNotification("notif-1");
    });

    expect(mockStorage.markIdAsRead).toHaveBeenCalledWith("notif-1");
    expect(mockStorage.removeIdFromRead).not.toHaveBeenCalled();
    expect(apiClient.acknowledgeTriggeredAlert).not.toHaveBeenCalled();
  });
});

/**
 * 確認失敗時畫面上看到的結果：清單用真的 state，toast 與重讀換成假的。
 * 觸發紀錄已經不在（規則或儲存庫刪了）當成已經處理完；其他失敗照寫入失敗的慣例說明並重讀。
 */
describe("useNotificationActions when acknowledging does not go through", () => {
  let storage: {
    markIdAsRead: ReturnType<typeof vi.fn<(id: string) => void>>;
    markIdsAsRead: ReturnType<typeof vi.fn<(ids: string[]) => void>>;
    removeIdFromRead: ReturnType<typeof vi.fn<(id: string) => void>>;
  };
  let feedback: ReturnType<typeof makeFeedback>;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = { markIdAsRead: vi.fn(), markIdsAsRead: vi.fn(), removeIdFromRead: vi.fn() };
    feedback = makeFeedback();
  });

  function renderWithList(initial: Notification[]) {
    return renderHook(() => {
      const [notifications, setNotifications] = useState(initial);
      const actions = useNotificationActions(notifications, setNotifications, storage, feedback);
      return { notifications, ...actions };
    });
  }

  const alertA = makeNotification({ id: "alert-42", metadata: { alertId: 42 } });
  const alertB = makeNotification({ id: "alert-43", metadata: { alertId: 43 } });
  const alertC = makeNotification({ id: "alert-44", metadata: { alertId: 44 } });

  function expectNoToast() {
    expect(feedback.toast.error).not.toHaveBeenCalled();
    expect(feedback.toast.warning).not.toHaveBeenCalled();
    expect(feedback.toast.info).not.toHaveBeenCalled();
    expect(feedback.toast.success).not.toHaveBeenCalled();
  }

  describe("the alert is already gone", () => {
    it("keeps a notification marked as read, without remembering its id, and reloads", async () => {
      vi.mocked(apiClient.acknowledgeTriggeredAlert).mockRejectedValue(gone());
      const { result } = renderWithList([alertA]);

      await act(async () => {
        await result.current.markAsRead("alert-42");
      });

      expect(result.current.notifications).toEqual([{ ...alertA, read: true }]);
      // 觸發紀錄的 id 會重用：記住的話，之後拿到同一個 id 的新警報會直接顯示成已讀
      expect(storage.markIdAsRead).not.toHaveBeenCalled();
      expect(feedback.refresh).toHaveBeenCalledTimes(1);
      expectNoToast();
    });

    it("keeps the gone ones read when marking all as read and remembers only the acknowledged", async () => {
      vi.mocked(apiClient.acknowledgeTriggeredAlert).mockImplementation((id) =>
        id === 43 ? Promise.reject(gone()) : Promise.resolve({ status: "acknowledged", id })
      );
      const { result } = renderWithList([alertA, alertB]);

      await act(async () => {
        await result.current.markAllAsRead();
      });

      expect(result.current.notifications.map((n) => n.read)).toEqual([true, true]);
      expect(storage.markIdsAsRead).toHaveBeenCalledTimes(1);
      expect(storage.markIdsAsRead).toHaveBeenCalledWith(["alert-42"]);
      expect(feedback.refresh).toHaveBeenCalledTimes(1);
      expectNoToast();
    });

    it("keeps a cleared notification out of the list and forgets its id", async () => {
      vi.mocked(apiClient.acknowledgeTriggeredAlert).mockRejectedValue(gone());
      const { result } = renderWithList([alertA, alertB]);

      await act(async () => {
        await result.current.clearNotification("alert-42");
      });

      expect(result.current.notifications).toEqual([alertB]);
      expect(storage.removeIdFromRead).toHaveBeenCalledWith("alert-42");
      expect(feedback.refresh).toHaveBeenCalledTimes(1);
      expectNoToast();
    });

    it("treats a 404 without that code as a failure", async () => {
      vi.mocked(apiClient.acknowledgeTriggeredAlert).mockRejectedValue(
        new ApiError(404, "Not Found")
      );
      const { result } = renderWithList([alertA]);

      await act(async () => {
        await result.current.markAsRead("alert-42");
      });

      expect(result.current.notifications).toEqual([alertA]);
      expect(feedback.toast.error).toHaveBeenCalledTimes(1);
      expect(feedback.toast.error).toHaveBeenCalledWith(
        withCause(copy.markRead.notDone, translations.en.failure.retry)
      );
    });
  });

  describe("acknowledging fails", () => {
    it("puts a notification back to unread, says why and reloads", async () => {
      vi.mocked(apiClient.acknowledgeTriggeredAlert).mockRejectedValue(unreachable());
      const { result } = renderWithList([alertA]);

      await act(async () => {
        await result.current.markAsRead("alert-42");
      });

      expect(result.current.notifications).toEqual([alertA]);
      expect(feedback.toast.error).toHaveBeenCalledTimes(1);
      expect(feedback.toast.error).toHaveBeenCalledWith(
        withCause(copy.markRead.notDone, translations.en.failure.engineUnreachable)
      );
      expect(feedback.toast.warning).not.toHaveBeenCalled();
      expect(feedback.refresh).toHaveBeenCalledTimes(1);
    });

    it("puts back only the failed ones when marking all as read and says how many", async () => {
      vi.mocked(apiClient.acknowledgeTriggeredAlert).mockImplementation((id) =>
        id === 42 ? Promise.resolve({ status: "acknowledged", id }) : Promise.reject(unreachable())
      );
      const { result } = renderWithList([alertA, alertB, alertC]);

      await act(async () => {
        await result.current.markAllAsRead();
      });

      expect(result.current.notifications.map((n) => n.read)).toEqual([true, false, false]);
      expect(feedback.toast.error).toHaveBeenCalledTimes(1);
      expect(feedback.toast.error).toHaveBeenCalledWith(
        withCause(
          interpolate(copy.markAllRead.notDone, { count: 2 }),
          translations.en.failure.engineUnreachable
        )
      );
      expect(feedback.refresh).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["the timed-out one comes first", 42],
      ["the timed-out one comes last", 43],
    ])(
      "when only some failures timed out (%s), says which were not done and which are unclear, and keeps reloading",
      async (_, timedOutId) => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
          vi.mocked(apiClient.acknowledgeTriggeredAlert).mockImplementation((id) =>
            Promise.reject(id === timedOutId ? timedOut() : unreachable())
          );
          const { result } = renderWithList([alertA, alertB]);

          await act(async () => {
            await result.current.markAllAsRead();
          });

          expect(result.current.notifications.map((n) => n.read)).toEqual([false, false]);
          expect(feedback.toast.error).toHaveBeenCalledTimes(1);
          expect(feedback.toast.error).toHaveBeenCalledWith(
            withCause(
              interpolate(copy.markAllRead.notDone, { count: 1 }),
              translations.en.failure.engineUnreachable
            )
          );
          // 逾時的那則可能其實做完了：另外說不確定
          expect(feedback.toast.warning).toHaveBeenCalledTimes(1);
          expect(feedback.toast.warning).toHaveBeenCalledWith(
            interpolate(copy.markAllRead.timedOut, { count: 1 })
          );
          expect(feedback.refresh).toHaveBeenCalledTimes(1);
          await act(async () => {
            await vi.advanceTimersByTimeAsync(BATCH_ADD_FOLLOWUP_INTERVAL_MS);
          });
          expect(feedback.refresh).toHaveBeenCalledTimes(2);
        } finally {
          vi.useRealTimers();
        }
      }
    );

    it.each([
      ["failed", unreachable, "error"],
      ["timed out", timedOut, "warning"],
    ] as const)(
      "when marking all as read, counts only the one that %s, not the one already gone",
      async (_, error, kind) => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
          vi.mocked(apiClient.acknowledgeTriggeredAlert).mockImplementation((id) =>
            Promise.reject(id === 42 ? gone() : error())
          );
          const { result } = renderWithList([alertA, alertB]);

          await act(async () => {
            await result.current.markAllAsRead();
          });

          // 不在的那則保持已讀，沒做成的那則還原
          expect(result.current.notifications.map((n) => n.read)).toEqual([true, false]);
          const shown = kind === "error" ? feedback.toast.error : feedback.toast.warning;
          const other = kind === "error" ? feedback.toast.warning : feedback.toast.error;
          expect(shown).toHaveBeenCalledTimes(1);
          expect(shown).toHaveBeenCalledWith(
            kind === "error"
              ? withCause(
                  interpolate(copy.markAllRead.notDone, { count: 1 }),
                  translations.en.failure.engineUnreachable
                )
              : interpolate(copy.markAllRead.timedOut, { count: 1 })
          );
          expect(other).not.toHaveBeenCalled();
          expect(storage.markIdsAsRead).not.toHaveBeenCalled();
          expect(feedback.refresh).toHaveBeenCalledTimes(1);
        } finally {
          vi.useRealTimers();
        }
      }
    );

    it("puts a cleared notification back, says why and reloads", async () => {
      vi.mocked(apiClient.acknowledgeTriggeredAlert).mockRejectedValue(unreachable());
      const { result } = renderWithList([alertA, alertB]);

      await act(async () => {
        await result.current.clearNotification("alert-42");
      });

      expect(result.current.notifications).toHaveLength(2);
      expect(result.current.notifications).toEqual(expect.arrayContaining([alertA, alertB]));
      expect(storage.removeIdFromRead).toHaveBeenCalledWith("alert-42");
      expect(feedback.toast.error).toHaveBeenCalledTimes(1);
      expect(feedback.toast.error).toHaveBeenCalledWith(
        withCause(copy.clear.notDone, translations.en.failure.engineUnreachable)
      );
      expect(feedback.refresh).toHaveBeenCalledTimes(1);
    });

    it("puts back a cleared notification that was already read as read", async () => {
      vi.mocked(apiClient.acknowledgeTriggeredAlert).mockRejectedValue(unreachable());
      const alreadyRead = { ...alertA, read: true };
      const { result } = renderWithList([alreadyRead]);

      await act(async () => {
        await result.current.clearNotification("alert-42");
      });

      expect(result.current.notifications).toEqual([alreadyRead]);
    });

    type Run = (actions: ReturnType<typeof useNotificationActions>) => Promise<void>;
    // 逾時也要先還原：讀回來時本機的已讀與後端的值取 OR，沒還原的話伺服器沒做完也會一直顯示成已讀
    const timeoutCases: [string, Run, () => string, Notification[]][] = [
      [
        "marking one as read",
        (a) => a.markAsRead("alert-42"),
        () => copy.markRead.timedOut,
        [alertA, alertB],
      ],
      [
        "marking all as read",
        (a) => a.markAllAsRead(),
        () => interpolate(copy.markAllRead.timedOut, { count: 2 }),
        [alertA, alertB],
      ],
      [
        "clearing one",
        (a) => a.clearNotification("alert-42"),
        () => copy.clear.timedOut,
        [alertB, alertA],
      ],
    ];

    it.each(timeoutCases)(
      "%s puts it back, says it is unclear and keeps reloading for a while after a timeout",
      async (_, run, message, listAfter) => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
          vi.mocked(apiClient.acknowledgeTriggeredAlert).mockRejectedValue(timedOut());
          const { result } = renderWithList([alertA, alertB]);

          await act(async () => {
            await run(result.current);
          });

          expect(result.current.notifications).toHaveLength(listAfter.length);
          expect(result.current.notifications).toEqual(expect.arrayContaining(listAfter));
          expect(feedback.toast.warning).toHaveBeenCalledTimes(1);
          expect(feedback.toast.warning).toHaveBeenCalledWith(message());
          expect(feedback.toast.error).not.toHaveBeenCalled();
          expect(feedback.refresh).toHaveBeenCalledTimes(1);
          await act(async () => {
            await vi.advanceTimersByTimeAsync(BATCH_ADD_FOLLOWUP_INTERVAL_MS);
          });
          expect(feedback.refresh).toHaveBeenCalledTimes(2);
          // 有期限：不會一直讀下去
          await act(async () => {
            await vi.advanceTimersByTimeAsync(BATCH_ADD_TIMEOUT_MS);
          });
          const afterWindow = feedback.refresh.mock.calls.length;
          await act(async () => {
            await vi.advanceTimersByTimeAsync(BATCH_ADD_TIMEOUT_MS);
          });
          expect(feedback.refresh).toHaveBeenCalledTimes(afterWindow);
        } finally {
          vi.useRealTimers();
        }
      }
    );
  });

  describe("reloading", () => {
    type Run = (actions: ReturnType<typeof useNotificationActions>) => Promise<void>;
    const cases: [string, Run, () => Error][] = [
      ["marking one as read, already gone", (a) => a.markAsRead("alert-42"), gone],
      ["marking one as read, failed", (a) => a.markAsRead("alert-42"), unreachable],
      ["marking all as read, already gone", (a) => a.markAllAsRead(), gone],
      ["marking all as read, failed", (a) => a.markAllAsRead(), unreachable],
      ["clearing one, already gone", (a) => a.clearNotification("alert-42"), gone],
      ["clearing one, failed", (a) => a.clearNotification("alert-42"), unreachable],
    ];

    it.each(cases)(
      "%s: reloads once, only after the answer came back, and not again later",
      async (_, run, error) => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
          let answer: (reason: Error) => void = () => {};
          vi.mocked(apiClient.acknowledgeTriggeredAlert).mockImplementation(
            () =>
              new Promise((_resolve, reject) => {
                answer = reject;
              })
          );
          const { result } = renderWithList([alertA]);

          let pending: Promise<void> = Promise.resolve();
          act(() => {
            pending = run(result.current);
          });
          // 確認還沒回來：這時讀回來的還是確認之前的樣子（先讓排進 microtask 的工作跑完）
          await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
          });
          expect(feedback.refresh).not.toHaveBeenCalled();

          await act(async () => {
            answer(error());
            await pending;
          });
          expect(feedback.refresh).toHaveBeenCalledTimes(1);

          // 只有逾時才需要定期重讀
          await act(async () => {
            await vi.advanceTimersByTimeAsync(BATCH_ADD_FOLLOWUP_INTERVAL_MS * 2);
          });
          expect(feedback.refresh).toHaveBeenCalledTimes(1);
        } finally {
          vi.useRealTimers();
        }
      }
    );
  });

  it("does not show the backend's own words", async () => {
    vi.mocked(apiClient.acknowledgeTriggeredAlert).mockRejectedValue(
      new ApiError(500, "Internal Server Error")
    );
    const { result } = renderWithList([alertA]);

    await act(async () => {
      await result.current.markAsRead("alert-42");
    });

    const shown = vi.mocked(feedback.toast.error).mock.calls.map(([message]) => message);
    expect(shown).toHaveLength(1);
    expect(shown[0]).not.toContain("Internal Server Error");
  });
});

describe("notification failure copy", () => {
  const zh = translations["zh-TW"].notifications.failed;

  it.each([
    ["markRead", zh.markRead],
    ["markAllRead", zh.markAllRead],
    ["clear", zh.clear],
  ])("%s: says it was not done, and on a timeout that it is unclear and will update", (_, c) => {
    expect(c.notDone).toContain("沒有");
    expect(c.notDone).not.toContain("不確定");
    expect(c.timedOut).toContain("不確定");
    expect(c.timedOut).toContain("自己更新");
  });

  it("counts the notifications when marking all as read", () => {
    expect(zh.markAllRead.notDone).toContain("{count}");
    expect(zh.markAllRead.timedOut).toContain("{count}");
    expect(copy.markAllRead.notDone).toContain("{count}");
    expect(copy.markAllRead.timedOut).toContain("{count}");
  });
});
