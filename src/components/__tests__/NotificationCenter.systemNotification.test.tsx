/**
 * 什麼時候為新通知跳系統通知：通知中心、useNotifications、輪詢查詢與 toast 用真的，API 與系統通知換成假的。
 * 假後端照正式後端的樣子回清單：依觸發時間由新到舊、先排除清除過的再取前 limit 則（鈴鐺是 50 則）。
 * 本機時鐘固定從 APP_OPENED_AT 起走：第 n 則（alertNo）是開 app 之後才觸發的，前一天的是開 app 之前就有的。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { ToastProvider } from "../Toast";
import { NotificationCenter } from "../NotificationCenter";
import { createTestQueryClient } from "../../lib/react-query";
import type { TriggeredAlert } from "../../api/types";
import { ALERT_FETCH_LIMIT } from "../../constants/api";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    listTriggeredAlerts: vi.fn(),
    acknowledgeTriggeredAlert: vi.fn(),
    dismissTriggeredAlert: vi.fn(),
  };
});

const { mockOSNotification } = vi.hoisted(() => ({
  mockOSNotification: {
    isGranted: true,
    isLoading: false,
    requestNotificationPermission: vi.fn(),
    sendOSNotification: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("../../hooks/useOSNotification", () => ({ useOSNotification: () => mockOSNotification }));

import { listTriggeredAlerts, dismissTriggeredAlert } from "../../api/client";

/** 開 app 的時間（本機時鐘；sidecar 與它同一台機器，觸發時間用的是同一個時鐘） */
const APP_OPENED_AT = new Date("2026-11-25T00:00:00Z");

/** 第 n 則：n 越大越新，都在開 app 之後 */
function alertNo(n: number, overrides: Partial<TriggeredAlert> = {}): TriggeredAlert {
  const minute = String(n % 60).padStart(2, "0");
  const hour = String(Math.floor(n / 60)).padStart(2, "0");
  return {
    id: n,
    rule_id: 7,
    rule_name: `Rule ${n}`,
    repo_id: 3,
    repo_name: "facebook/react",
    signal_type: "velocity",
    signal_value: 31,
    threshold: 30,
    operator: ">",
    triggered_at: `2026-11-25T${hour}:${minute}:00.123456+00:00`,
    acknowledged: false,
    acknowledged_at: null,
    ...overrides,
  };
}

/** 假後端的觸發紀錄與清除過的 id */
let server: TriggeredAlert[];
let dismissed: Set<number>;
let client: QueryClient;

function renderCenter() {
  client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <NotificationCenter onNavigate={vi.fn()} />
      </ToastProvider>
    </QueryClientProvider>
  );
}

async function readTheListAgain() {
  const calls = vi.mocked(listTriggeredAlerts).mock.calls.length;
  await act(async () => {
    await client.invalidateQueries();
  });
  await waitFor(() => {
    expect(vi.mocked(listTriggeredAlerts).mock.calls.length).toBeGreaterThan(calls);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

async function clear(user: ReturnType<typeof userEvent.setup>, ruleName: string) {
  const dropdown = screen.getByRole("region", { name: "Notifications" });
  const item = within(dropdown).getByText(ruleName).closest(".notification-item");
  if (!(item instanceof HTMLElement)) throw new Error(`找不到 ${ruleName} 那一列`);
  await user.click(within(item).getByRole("button", { name: "Clear" }));
  await waitFor(() => {
    expect(dismissTriggeredAlert).toHaveBeenCalled();
  });
}

/** 假後端回的清單：依觸發時間由新到舊、先排除清除過的再取前 limit 則 */
function listFromServer(...[, limit, , options]: Parameters<typeof listTriggeredAlerts>) {
  return Promise.resolve(
    [...server]
      .sort((a, b) => b.triggered_at.localeCompare(a.triggered_at))
      .filter((a) => !(options?.excludeDismissed && dismissed.has(a.id)))
      .slice(0, limit)
  );
}

const sentBodies = () =>
  mockOSNotification.sendOSNotification.mock.calls.map(
    (call) => (call as unknown as [{ body: string }])[0].body
  );

describe("NotificationCenter system notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"], now: APP_OPENED_AT, shouldAdvanceTime: true });
    server = [];
    dismissed = new Set();
    vi.mocked(listTriggeredAlerts).mockImplementation(listFromServer);
    vi.mocked(dismissTriggeredAlert).mockImplementation((id) => {
      dismissed.add(id);
      return Promise.resolve({ status: "dismissed", id });
    });
  });

  afterEach(() => {
    client.clear();
    vi.useRealTimers();
  });

  it("does not notify about what is already there when the app opens", async () => {
    server = [alertNo(1), alertNo(2)];
    renderCenter();
    await screen.findByRole("button", { name: "Notifications (2 unread)" });

    await readTheListAgain();

    expect(mockOSNotification.sendOSNotification).not.toHaveBeenCalled();
  });

  it("notifies about an alert that arrives after the app opened with no notifications", async () => {
    const user = userEvent.setup();
    renderCenter();
    // 等第一次讀回真的顯示出來：它是判斷新通知的基準
    await user.click(screen.getByRole("button", { name: "Notifications" }));
    await screen.findByText("No notifications");

    server = [alertNo(1)];
    await readTheListAgain();

    expect(sentBodies()).toHaveLength(1);
  });

  it("notifies about a new alert after every notification was cleared", async () => {
    server = [alertNo(1)];
    const user = userEvent.setup();
    renderCenter();
    await user.click(await screen.findByRole("button", { name: "Notifications (1 unread)" }));
    await clear(user, "Rule 1");
    await readTheListAgain();

    server = [...server, alertNo(2)];
    await readTheListAgain();

    expect(sentBodies()).toHaveLength(1);
  });

  it("does not notify about an older alert that slides into the list after one is cleared", async () => {
    // 比鈴鐺能列的多一則：清掉最新的那則之後，最舊的那則補進清單
    server = Array.from({ length: ALERT_FETCH_LIMIT + 1 }, (_, i) => alertNo(i + 1));
    const user = userEvent.setup();
    renderCenter();
    await user.click(await screen.findByRole("button", { name: /Notifications \(50 unread\)/ }));
    expect(screen.queryByText("Rule 1")).not.toBeInTheDocument();
    await clear(user, `Rule ${ALERT_FETCH_LIMIT + 1}`);

    await readTheListAgain();

    expect(await screen.findByText("Rule 1")).toBeInTheDocument();
    expect(mockOSNotification.sendOSNotification).not.toHaveBeenCalled();
  });

  it("does not notify again about the newest one when it comes back", async () => {
    // 例如它的 repo 取消追蹤（清單上看不到）之後又重新追蹤
    server = [alertNo(1), alertNo(2)];
    renderCenter();
    await screen.findByRole("button", { name: "Notifications (2 unread)" });
    server = [alertNo(1)];
    await readTheListAgain();

    server = [alertNo(1), alertNo(2)];
    await readTheListAgain();

    expect(mockOSNotification.sendOSNotification).not.toHaveBeenCalled();
  });

  it("does not notify about an older alert it has not seen, even after the list was empty", async () => {
    server = [alertNo(5)];
    const user = userEvent.setup();
    renderCenter();
    await user.click(await screen.findByRole("button", { name: "Notifications (1 unread)" }));
    await clear(user, "Rule 5");
    await readTheListAgain();

    // 重新追蹤的 repo 帶回一則這次開 app 沒看過、但比看過的最新還舊的警報
    server = [...server, alertNo(1)];
    await readTheListAgain();

    expect(mockOSNotification.sendOSNotification).not.toHaveBeenCalled();
  });

  it("notifies about a new alert triggered in the same millisecond as the newest one seen", async () => {
    server = [alertNo(1, { triggered_at: "2026-11-25T00:01:00.123456+00:00" })];
    renderCenter();
    await screen.findByRole("button", { name: "Notifications (1 unread)" });

    // 時間解析只到毫秒：同一毫秒、不同微秒的新警報也要算新的
    server = [...server, alertNo(2, { triggered_at: "2026-11-25T00:01:00.123999+00:00" })];
    await readTheListAgain();

    expect(sentBodies()).toHaveLength(1);
  });

  it("does not notify about a new alert that is already acknowledged", async () => {
    server = [alertNo(1)];
    renderCenter();
    await screen.findByRole("button", { name: "Notifications (1 unread)" });

    server = [
      ...server,
      alertNo(2, { acknowledged: true, acknowledged_at: "2026-11-25T00:03:00+00:00" }),
    ];
    await readTheListAgain();

    expect(mockOSNotification.sendOSNotification).not.toHaveBeenCalled();
  });

  it("does not notify about an alert from before the app opened that comes back, after an empty first read", async () => {
    // 例如重新追蹤一個封存的 repo：封存期間不列的舊警報回到清單
    const user = userEvent.setup();
    renderCenter();
    await user.click(screen.getByRole("button", { name: "Notifications" }));
    await screen.findByText("No notifications");

    server = [alertNo(1, { triggered_at: "2026-11-24T23:00:00+00:00" })];
    await readTheListAgain();

    expect(await screen.findByText("Rule 1")).toBeInTheDocument();
    expect(mockOSNotification.sendOSNotification).not.toHaveBeenCalled();
  });

  it("does not notify about an alert from before the app opened that comes back, newer than what it first read", async () => {
    server = [alertNo(1, { triggered_at: "2026-11-24T22:00:00+00:00" })];
    renderCenter();
    await screen.findByRole("button", { name: "Notifications (1 unread)" });

    server = [...server, alertNo(2, { triggered_at: "2026-11-24T23:00:00+00:00" })];
    await readTheListAgain();

    expect(
      await screen.findByRole("button", { name: "Notifications (2 unread)" })
    ).toBeInTheDocument();
    expect(mockOSNotification.sendOSNotification).not.toHaveBeenCalled();
  });

  it("notifies about an alert triggered after the first read was sent, even when that read did not have it", async () => {
    // 第一次讀取送出之後、讀回之前才觸發：不在那次的清單裡，下一次讀回時是新的
    vi.mocked(listTriggeredAlerts).mockImplementationOnce(async (...args) => {
      const sentAt = Date.now();
      const snapshot = await listFromServer(...args);
      server = [alertNo(1, { triggered_at: new Date(sentAt + 1).toISOString() })];
      // 讀回比觸發晚：用讀回的時間當基準的話，這則會被當成舊的
      await new Promise((r) => setTimeout(r, 50));
      return snapshot;
    });
    const user = userEvent.setup();
    renderCenter();
    await user.click(screen.getByRole("button", { name: "Notifications" }));
    await screen.findByText("No notifications");

    await readTheListAgain();

    expect(sentBodies()).toHaveLength(1);
  });

  it("notifies about an alert whose trigger time was taken just before a later read was sent", async () => {
    // 觸發時間先取、寫進資料庫在後：那次讀取還讀不到它，下一次讀到時要算新的。只有第一次讀取墊高基準
    const user = userEvent.setup();
    renderCenter();
    await user.click(screen.getByRole("button", { name: "Notifications" }));
    await screen.findByText("No notifications");
    // 讓時鐘走過第一次讀取的時間
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    vi.mocked(listTriggeredAlerts).mockImplementationOnce(async (...args) => {
      const snapshot = await listFromServer(...args);
      server = [alertNo(1, { triggered_at: new Date(Date.now() - 1).toISOString() })];
      return snapshot;
    });
    await readTheListAgain();
    expect(screen.getByText("No notifications")).toBeInTheDocument();

    await readTheListAgain();

    expect(sentBodies()).toHaveLength(1);
  });

  it("judges the first read by the time it was sent, even when the next read starts before the first is handled", async () => {
    // 送出的時間跟著資料一起回的理由：放 ref 的話，下一次讀取在處理第一次的結果之前就開始，會把它蓋掉
    let sentAt = 0;
    vi.mocked(listTriggeredAlerts)
      .mockImplementationOnce(async (...args) => {
        sentAt = Date.now();
        const snapshot = await listFromServer(...args);
        await new Promise((r) => setTimeout(r, 50));
        // 讀回之前就排好下一次讀取：它在處理這次的結果之前開始
        setTimeout(() => void client.invalidateQueries(), 0);
        return snapshot;
      })
      .mockImplementationOnce(async (...args) => {
        await new Promise((r) => setTimeout(r, 50));
        // 第一次讀取送出之後才觸發、那次沒讀到
        server = [alertNo(1, { triggered_at: new Date(sentAt + 1).toISOString() })];
        return listFromServer(...args);
      });
    renderCenter();

    await waitFor(() => {
      expect(listTriggeredAlerts).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(sentBodies()).toHaveLength(1);
    });
  });
});
