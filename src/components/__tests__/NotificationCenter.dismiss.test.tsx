/**
 * 通知中心的「清除」＝從鈴鐺移除、之後不再出現（儀表板的近期活動照列，那是後端預設清單的事）。
 * 通知中心、useNotifications、輪詢查詢與 toast 用真的，API 與系統通知換成假的。
 * 假後端記得哪些清除過：鈴鐺的清單（excludeDismissed）不列它們，清除的回應送出時才算清除完成。
 * 本機時鐘固定在兩則警報之前：「不跳系統通知」要靠讀回過的 id 擋，不能是因為觸發時間比開 app 早
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { ToastProvider } from "../Toast";
import { NotificationCenter } from "../NotificationCenter";
import { createTestQueryClient } from "../../lib/react-query";
import { ApiError } from "../../api/types";
import type { TriggeredAlert } from "../../api/types";
import { API_ERROR_MESSAGES } from "../../constants/api";

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

import {
  listTriggeredAlerts,
  acknowledgeTriggeredAlert,
  dismissTriggeredAlert,
} from "../../api/client";

const alert: TriggeredAlert = {
  id: 42,
  rule_id: 7,
  rule_name: "Star spike",
  repo_id: 3,
  repo_name: "facebook/react",
  signal_type: "velocity",
  signal_value: 31,
  threshold: 30,
  operator: ">",
  triggered_at: "2026-11-25T00:00:00.123456+00:00",
  acknowledged: false,
  acknowledged_at: null,
};
const other: TriggeredAlert = {
  ...alert,
  id: 43,
  rule_name: "Another rule",
  triggered_at: "2026-11-24T00:00:00+00:00",
};

let client: QueryClient;
/** 假後端：清除過的 id */
let dismissed: Set<number>;

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

async function openAndClearStarSpike(
  user: ReturnType<typeof userEvent.setup>,
  bellName = "Notifications (2 unread)"
) {
  await user.click(await screen.findByRole("button", { name: bellName }));
  const dropdown = screen.getByRole("region", { name: "Notifications" });
  const item = within(dropdown).getByText("Star spike").closest(".notification-item");
  if (!(item instanceof HTMLElement)) throw new Error("找不到 Star spike 那一列");
  await user.click(within(item).getByRole("button", { name: "Clear" }));
  return dropdown;
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

describe("NotificationCenter clearing a notification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-11-23T00:00:00Z"),
      shouldAdvanceTime: true,
    });
    dismissed = new Set();
    vi.mocked(listTriggeredAlerts).mockImplementation((_unread, _limit, _signal, options) =>
      Promise.resolve(
        [alert, other].filter((a) => !(options?.excludeDismissed && dismissed.has(a.id)))
      )
    );
    vi.mocked(acknowledgeTriggeredAlert).mockImplementation((id) =>
      Promise.resolve({ status: "acknowledged", id })
    );
    vi.mocked(dismissTriggeredAlert).mockImplementation((id) => {
      dismissed.add(id);
      return Promise.resolve({ status: "dismissed", id });
    });
  });

  afterEach(() => {
    client.clear();
    vi.useRealTimers();
  });

  it("keeps it out of the bell after the list is read again", async () => {
    const user = userEvent.setup();
    renderCenter();
    const dropdown = await openAndClearStarSpike(user);
    await waitFor(() => {
      expect(dismissTriggeredAlert).toHaveBeenCalledWith(42, alert.triggered_at);
    });

    await readTheListAgain();

    expect(within(dropdown).queryByText("Star spike")).not.toBeInTheDocument();
    expect(within(dropdown).getByText("Another rule")).toBeInTheDocument();
    expect(acknowledgeTriggeredAlert).not.toHaveBeenCalled();
  });

  it("keeps it out of the bell after the app is opened again", async () => {
    const user = userEvent.setup();
    const first = renderCenter();
    await openAndClearStarSpike(user);
    await waitFor(() => {
      expect(dismissTriggeredAlert).toHaveBeenCalledTimes(1);
    });
    first.unmount();
    client.clear();

    // 重開 app：本機的標記都不在了，只剩後端記得的
    renderCenter();
    await user.click(await screen.findByRole("button", { name: "Notifications (1 unread)" }));
    const dropdown = screen.getByRole("region", { name: "Notifications" });
    expect(within(dropdown).getByText("Another rule")).toBeInTheDocument();
    expect(within(dropdown).queryByText("Star spike")).not.toBeInTheDocument();
  });

  it("does not bring back an already read one while clearing it is on its way", async () => {
    const readAlert = {
      ...alert,
      acknowledged: true,
      acknowledged_at: "2026-11-25T00:10:00+00:00",
    };
    vi.mocked(listTriggeredAlerts).mockImplementation((_unread, _limit, _signal, options) =>
      Promise.resolve(
        [readAlert, other].filter((a) => !(options?.excludeDismissed && dismissed.has(a.id)))
      )
    );
    let answer: () => void = () => {};
    vi.mocked(dismissTriggeredAlert).mockImplementation(
      (id) =>
        new Promise((resolve) => {
          answer = () => {
            dismissed.add(id);
            resolve({ status: "dismissed", id });
          };
        })
    );
    const user = userEvent.setup();
    renderCenter();
    const dropdown = await openAndClearStarSpike(user, "Notifications (1 unread)");

    await readTheListAgain();

    expect(within(dropdown).queryByText("Star spike")).not.toBeInTheDocument();
    await act(async () => {
      answer();
    });
  });

  it("does not bring it back, or notify about it, while clearing is on its way", async () => {
    let answer: () => void = () => {};
    vi.mocked(dismissTriggeredAlert).mockImplementation(
      (id) =>
        new Promise((resolve) => {
          answer = () => {
            dismissed.add(id);
            resolve({ status: "dismissed", id });
          };
        })
    );
    const user = userEvent.setup();
    renderCenter();
    const dropdown = await openAndClearStarSpike(user);

    // 後端還沒清除完，讀回的清單仍列著它
    await readTheListAgain();

    expect(within(dropdown).queryByText("Star spike")).not.toBeInTheDocument();
    expect(mockOSNotification.sendOSNotification).not.toHaveBeenCalled();
    await act(async () => {
      answer();
    });
  });

  it("brings it back when clearing fails, without notifying about it as a new alert", async () => {
    let answer: (reason: Error) => void = () => {};
    vi.mocked(dismissTriggeredAlert).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          answer = reject;
        })
    );
    const user = userEvent.setup();
    renderCenter();
    const dropdown = await openAndClearStarSpike(user);
    await readTheListAgain();

    await act(async () => {
      answer(new ApiError(0, `${API_ERROR_MESSAGES.NETWORK_ERROR}: connection refused`));
    });
    await readTheListAgain();

    expect(within(dropdown).getByText("Star spike")).toBeInTheDocument();
    expect(mockOSNotification.sendOSNotification).not.toHaveBeenCalled();
  });
});
