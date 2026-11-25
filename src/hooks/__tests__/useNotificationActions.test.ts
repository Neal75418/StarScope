import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState } from "react";
import { useNotificationActions } from "../useNotificationActions";
import type { Notification } from "../useNotifications";
import type { LocalMarks } from "../../utils/notificationHelpers";
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
    dismissTriggeredAlert: vi.fn(),
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
    metadata: { alertId: 42, triggeredAt: "2024-01-20T00:00:00+00:00" },
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

let localMarks: { current: LocalMarks };
/** 還留著的標記數（已讀＋清除） */
const marksLeft = () => localMarks.current.reads.size + localMarks.current.dismissals.size;
let feedback: ReturnType<typeof makeFeedback>;

/** 清單用真的 state；localMarks 用真的 Set，toast 與重讀換成假的 */
function renderWithList(initial: Notification[]) {
  return renderHook(() => {
    const [notifications, setNotifications] = useState(initial);
    const actions = useNotificationActions(notifications, setNotifications, localMarks, feedback);
    return { notifications, setNotifications, ...actions };
  });
}

const alertA = makeNotification({
  id: "alert-42",
  metadata: { alertId: 42, triggeredAt: "2026-11-25T00:00:42+00:00" },
});
const alertB = makeNotification({
  id: "alert-43",
  metadata: { alertId: 43, triggeredAt: "2026-11-25T00:00:43+00:00" },
});
const alertC = makeNotification({
  id: "alert-44",
  metadata: { alertId: 44, triggeredAt: "2026-11-25T00:00:44+00:00" },
});
const systemNote = makeNotification({ id: "system-1", type: "system", metadata: undefined });

beforeEach(() => {
  vi.clearAllMocks();
  localMarks = { current: { reads: new Set(), dismissals: new Set() } };
  feedback = makeFeedback();
  vi.mocked(apiClient.acknowledgeTriggeredAlert).mockImplementation((id) =>
    Promise.resolve({ status: "acknowledged", id })
  );
  vi.mocked(apiClient.dismissTriggeredAlert).mockImplementation((id) =>
    Promise.resolve({ status: "dismissed", id })
  );
});

/** 標已讀走 acknowledge、清除走 dismiss：情境表要三種動作通用時，兩個都設成同樣的結果 */
function everyRequest() {
  return [
    vi.mocked(apiClient.acknowledgeTriggeredAlert),
    vi.mocked(apiClient.dismissTriggeredAlert),
  ];
}

describe("useNotificationActions", () => {
  it("marks one as read, acknowledges it with the trigger time it was listed with, and keeps it marked for this session", async () => {
    const { result } = renderWithList([alertA]);

    await act(async () => {
      await result.current.markAsRead("alert-42");
    });

    expect(result.current.notifications).toEqual([{ ...alertA, read: true }]);
    expect(apiClient.acknowledgeTriggeredAlert).toHaveBeenCalledWith(
      42,
      "2026-11-25T00:00:42+00:00"
    );
    // 確認成功後留著：輪詢可能讀回確認之前送出的請求（見 LocalMarks）
    expect(localMarks.current.reads.has("alert-42")).toBe(true);
  });

  it("claims the read while the acknowledgement is on its way", async () => {
    let answer: () => void = () => {};
    vi.mocked(apiClient.acknowledgeTriggeredAlert).mockImplementation(
      (id) =>
        new Promise((resolve) => {
          answer = () => resolve({ status: "acknowledged", id });
        })
    );
    const { result } = renderWithList([alertA]);

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.markAsRead("alert-42");
    });
    expect(localMarks.current.reads.has("alert-42")).toBe(true);

    await act(async () => {
      answer();
      await pending;
    });
    expect(localMarks.current.reads.has("alert-42")).toBe(true);
  });

  it("does not call the server or claim anything for a notification that is not an alert", async () => {
    const { result } = renderWithList([systemNote]);

    await act(async () => {
      await result.current.markAsRead("system-1");
    });

    expect(result.current.notifications).toEqual([{ ...systemNote, read: true }]);
    expect(apiClient.acknowledgeTriggeredAlert).not.toHaveBeenCalled();
    expect(marksLeft()).toBe(0);
  });

  it("marks all as read and acknowledges every unread alert with its trigger time", async () => {
    const { result } = renderWithList([alertA, { ...alertB, read: true }, alertC, systemNote]);

    await act(async () => {
      await result.current.markAllAsRead();
    });

    expect(result.current.notifications.every((n) => n.read)).toBe(true);
    expect(apiClient.acknowledgeTriggeredAlert).toHaveBeenCalledTimes(2);
    expect(apiClient.acknowledgeTriggeredAlert).toHaveBeenCalledWith(
      42,
      "2026-11-25T00:00:42+00:00"
    );
    expect(apiClient.acknowledgeTriggeredAlert).toHaveBeenCalledWith(
      44,
      "2026-11-25T00:00:44+00:00"
    );
    expect([...localMarks.current.reads]).toEqual(["alert-42", "alert-44"]);
  });

  it("clears one: takes it out of the list and asks the server to dismiss it with its trigger time", async () => {
    const { result } = renderWithList([alertA, alertB]);

    await act(async () => {
      await result.current.clearNotification("alert-42");
    });

    expect(result.current.notifications).toEqual([alertB]);
    expect(apiClient.dismissTriggeredAlert).toHaveBeenCalledWith(42, "2026-11-25T00:00:42+00:00");
    expect(apiClient.acknowledgeTriggeredAlert).not.toHaveBeenCalled();
    // 成功的留著：輪詢可能讀回清除之前送出的請求（見 LocalMarks）
    expect(localMarks.current.dismissals.has("alert-42")).toBe(true);
    expect(localMarks.current.reads.size).toBe(0);
  });

  it("marks it dismissed while the request is on its way", async () => {
    let answer: () => void = () => {};
    vi.mocked(apiClient.dismissTriggeredAlert).mockImplementation(
      (id) =>
        new Promise((resolve) => {
          answer = () => resolve({ status: "dismissed", id });
        })
    );
    const { result } = renderWithList([alertA]);

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.clearNotification("alert-42");
    });
    expect(localMarks.current.dismissals.has("alert-42")).toBe(true);

    await act(async () => {
      answer();
      await pending;
    });
    expect(localMarks.current.dismissals.has("alert-42")).toBe(true);
  });

  it("clears a notification that is not an alert without calling the server", async () => {
    const { result } = renderWithList([systemNote]);

    await act(async () => {
      await result.current.clearNotification("system-1");
    });

    expect(result.current.notifications).toEqual([]);
    expect(apiClient.acknowledgeTriggeredAlert).not.toHaveBeenCalled();
  });
});

/**
 * 確認失敗時畫面上看到的結果。觸發紀錄已經不在（規則或儲存庫刪了、id 被重用）當成已經處理完；
 * 其他失敗照寫入失敗的慣例說明並重讀。兩種都要從 localMarks 拿掉，否則輪詢讀回來時會一直顯示成已讀（標已讀）或一直不顯示（清除）。
 */
describe("useNotificationActions when acknowledging does not go through", () => {
  function expectNoToast() {
    expect(feedback.toast.error).not.toHaveBeenCalled();
    expect(feedback.toast.warning).not.toHaveBeenCalled();
    expect(feedback.toast.info).not.toHaveBeenCalled();
    expect(feedback.toast.success).not.toHaveBeenCalled();
  }

  describe("the alert is already gone", () => {
    it("keeps a notification marked as read, drops the claim and reloads", async () => {
      vi.mocked(apiClient.acknowledgeTriggeredAlert).mockRejectedValue(gone());
      const { result } = renderWithList([alertA]);

      await act(async () => {
        await result.current.markAsRead("alert-42");
      });

      expect(result.current.notifications).toEqual([{ ...alertA, read: true }]);
      expect(marksLeft()).toBe(0);
      expect(feedback.refresh).toHaveBeenCalledTimes(1);
      expectNoToast();
    });

    it("keeps the gone ones read when marking all as read and keeps the claim only for the acknowledged", async () => {
      vi.mocked(apiClient.acknowledgeTriggeredAlert).mockImplementation((id) =>
        id === 43 ? Promise.reject(gone()) : Promise.resolve({ status: "acknowledged", id })
      );
      const { result } = renderWithList([alertA, alertB]);

      await act(async () => {
        await result.current.markAllAsRead();
      });

      expect(result.current.notifications.map((n) => n.read)).toEqual([true, true]);
      expect([...localMarks.current.reads]).toEqual(["alert-42"]);
      expect(feedback.refresh).toHaveBeenCalledTimes(1);
      expectNoToast();
    });

    it("keeps a cleared notification out of the list and drops the claim", async () => {
      vi.mocked(apiClient.dismissTriggeredAlert).mockRejectedValue(gone());
      const { result } = renderWithList([alertA, alertB]);

      await act(async () => {
        await result.current.clearNotification("alert-42");
      });

      expect(result.current.notifications).toEqual([alertB]);
      expect(marksLeft()).toBe(0);
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
      expect(marksLeft()).toBe(0);
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
      expect([...localMarks.current.reads]).toEqual(["alert-42"]);
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
          expect(marksLeft()).toBe(0);
          expect(feedback.refresh).toHaveBeenCalledTimes(1);
        } finally {
          vi.useRealTimers();
        }
      }
    );

    it("puts a cleared notification back, says why and reloads", async () => {
      vi.mocked(apiClient.dismissTriggeredAlert).mockRejectedValue(unreachable());
      const { result } = renderWithList([alertA, alertB]);

      await act(async () => {
        await result.current.clearNotification("alert-42");
      });

      expect(result.current.notifications).toHaveLength(2);
      expect(result.current.notifications).toEqual(expect.arrayContaining([alertA, alertB]));
      expect(marksLeft()).toBe(0);
      expect(feedback.toast.error).toHaveBeenCalledTimes(1);
      expect(feedback.toast.error).toHaveBeenCalledWith(
        withCause(copy.clear.notDone, translations.en.failure.engineUnreachable)
      );
      expect(feedback.refresh).toHaveBeenCalledTimes(1);
    });

    it("does not put a cleared notification back twice when the list already brought it back", async () => {
      let answer: (reason: Error) => void = () => {};
      vi.mocked(apiClient.dismissTriggeredAlert).mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            answer = reject;
          })
      );
      const { result } = renderWithList([alertA, alertB]);

      let pending: Promise<void> = Promise.resolve();
      act(() => {
        pending = result.current.clearNotification("alert-42");
      });
      // 清除還在路上時清單裡又有它（正式流程中清除中的會在合併時排除，這裡守的是去重這道防線）
      act(() => {
        result.current.setNotifications((prev) => [...prev, alertA]);
      });
      await act(async () => {
        answer(unreachable());
        await pending;
      });

      expect(result.current.notifications.filter((n) => n.id === "alert-42")).toHaveLength(1);
    });

    it("puts back a cleared notification that was already read as read", async () => {
      vi.mocked(apiClient.dismissTriggeredAlert).mockRejectedValue(unreachable());
      const alreadyRead = { ...alertA, read: true };
      const { result } = renderWithList([alreadyRead]);

      await act(async () => {
        await result.current.clearNotification("alert-42");
      });

      expect(result.current.notifications).toEqual([alreadyRead]);
    });

    type Run = (actions: ReturnType<typeof useNotificationActions>) => Promise<void>;
    // 逾時也先還原、從 localMarks 拿掉：重讀回來之前（或重讀也失敗時）畫面照實顯示沒確認
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
          for (const request of everyRequest()) request.mockRejectedValue(timedOut());
          const { result } = renderWithList([alertA, alertB]);

          await act(async () => {
            await run(result.current);
          });

          expect(result.current.notifications).toHaveLength(listAfter.length);
          expect(result.current.notifications).toEqual(expect.arrayContaining(listAfter));
          expect(marksLeft()).toBe(0);
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
          for (const request of everyRequest()) {
            request.mockImplementation(
              () =>
                new Promise((_resolve, reject) => {
                  answer = reject;
                })
            );
          }
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
