/**
 * 通知中心按「全部標為已讀」時後端沒有確認成功：通知中心、useNotifications、輪詢查詢與 toast 用真的，
 * API 與系統通知換成假的。假的通知清單記得規則刪了沒：刪了之後觸發紀錄跟著不在，讀回來是空的。
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
    isGranted: false,
    isLoading: false,
    requestNotificationPermission: vi.fn(),
    sendOSNotification: vi.fn(),
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
  triggered_at: "2026-11-25T00:00:00Z",
  acknowledged: false,
  acknowledged_at: null,
};

let client: QueryClient;
/** 假的通知清單：規則刪掉之後觸發紀錄跟著不在 */
let ruleDeleted: boolean;

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

async function openWithOneUnread(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Notifications (1 unread)" }));
  return screen.getByRole("region", { name: "Notifications" });
}

describe("NotificationCenter when acknowledging does not go through", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    ruleDeleted = false;
    vi.mocked(listTriggeredAlerts).mockImplementation(() =>
      Promise.resolve(ruleDeleted ? [] : [alert])
    );
  });

  afterEach(() => {
    client.clear();
  });

  it("drops a notification whose alert is already gone, without saying it failed", async () => {
    vi.mocked(acknowledgeTriggeredAlert).mockImplementation(() =>
      Promise.reject(new ApiError(404, "Alert not found", "TRIGGERED_ALERT_NOT_FOUND"))
    );
    const user = userEvent.setup();
    renderCenter();
    const dropdown = await openWithOneUnread(user);
    ruleDeleted = true;

    await user.click(within(dropdown).getByRole("button", { name: "Mark all as read" }));

    expect(await within(dropdown).findByText("No notifications")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
    // 一則提示都沒有（toast 容器在畫面上，裡面是空的）
    expect(document.querySelector(".toast-container")?.children).toHaveLength(0);
  });

  it("keeps it read when the list is read again before the acknowledgement comes back", async () => {
    let answer: () => void = () => {};
    vi.mocked(acknowledgeTriggeredAlert).mockImplementation(
      (id) =>
        new Promise((resolve) => {
          answer = () => resolve({ status: "acknowledged", id });
        })
    );
    const user = userEvent.setup();
    renderCenter();
    const dropdown = await openWithOneUnread(user);
    await user.click(within(dropdown).getByRole("button", { name: "Mark all as read" }));

    // 後端還沒確認完時讀回的清單仍說它未讀，同時多了一則新警報：只有新的那則算未讀
    vi.mocked(listTriggeredAlerts).mockResolvedValue([
      alert,
      { ...alert, id: 43, rule_name: "Another rule", triggered_at: "2026-11-25T02:00:00Z" },
    ]);
    await act(async () => {
      await client.invalidateQueries();
    });
    expect(
      await screen.findByRole("button", { name: "Notifications (1 unread)" })
    ).toBeInTheDocument();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.getByRole("button", { name: "Notifications (1 unread)" })).toBeInTheDocument();

    await act(async () => {
      answer();
    });
  });

  it("shows it unread again when marking it read and then clearing it both fail", async () => {
    // 兩個確認都還在路上；清除失敗時加回的是按清除當下的樣子（已讀），重讀後要照後端改回未讀
    const answers: ((reason: Error) => void)[] = [];
    const waitForAnswer = () =>
      new Promise<never>((_resolve, reject) => {
        answers.push(reject);
      });
    vi.mocked(acknowledgeTriggeredAlert).mockImplementation(waitForAnswer);
    vi.mocked(dismissTriggeredAlert).mockImplementation(waitForAnswer);
    const user = userEvent.setup();
    renderCenter();
    const dropdown = await openWithOneUnread(user);
    await user.click(within(dropdown).getByRole("button", { name: /Star spike/ }));
    await user.click(await screen.findByRole("button", { name: "Notifications" }));
    await user.click(
      within(screen.getByRole("region", { name: "Notifications" })).getByRole("button", {
        name: "Clear",
      })
    );
    expect(answers).toHaveLength(2);

    const unreachable = () =>
      new ApiError(0, `${API_ERROR_MESSAGES.NETWORK_ERROR}: connection refused`);
    await act(async () => {
      answers[0](unreachable());
      answers[1](unreachable());
    });

    await waitFor(() => {
      expect(listTriggeredAlerts).toHaveBeenCalledTimes(3);
    });
    expect(
      await screen.findByRole("button", { name: "Notifications (1 unread)" })
    ).toBeInTheDocument();
  });

  it("does not say it was not marked as read when clearing it went through", async () => {
    // 清除會一併確認：標已讀的確認在清除之後才失敗，使用者要的已經達成
    let failAcknowledgement: (reason: Error) => void = () => {};
    vi.mocked(acknowledgeTriggeredAlert).mockImplementation(
      () =>
        new Promise<never>((_resolve, reject) => {
          failAcknowledgement = reject;
        })
    );
    vi.mocked(dismissTriggeredAlert).mockImplementation((id) => {
      ruleDeleted = true;
      return Promise.resolve({ status: "dismissed", id });
    });
    const user = userEvent.setup();
    renderCenter();
    const dropdown = await openWithOneUnread(user);
    await user.click(within(dropdown).getByRole("button", { name: /Star spike/ }));
    await user.click(await screen.findByRole("button", { name: "Notifications" }));
    await user.click(
      within(screen.getByRole("region", { name: "Notifications" })).getByRole("button", {
        name: "Clear",
      })
    );
    expect(await screen.findByText("No notifications")).toBeInTheDocument();

    await act(async () => {
      failAcknowledgement(
        new ApiError(0, `${API_ERROR_MESSAGES.NETWORK_ERROR}: connection refused`)
      );
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(screen.getByText("No notifications")).toBeInTheDocument();
    // 一則提示都沒有（toast 容器在畫面上，裡面是空的）
    expect(document.querySelector(".toast-container")?.children).toHaveLength(0);
  });

  it("says on screen that it was not marked as read and why, and reloads the list", async () => {
    vi.mocked(acknowledgeTriggeredAlert).mockRejectedValue(
      new ApiError(0, `${API_ERROR_MESSAGES.NETWORK_ERROR}: connection refused`)
    );
    const user = userEvent.setup();
    renderCenter();
    const dropdown = await openWithOneUnread(user);

    await user.click(within(dropdown).getByRole("button", { name: "Mark all as read" }));

    expect(
      await screen.findByText(
        "Notifications not marked as read: 1. The data engine can't be reached."
      )
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(listTriggeredAlerts).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByRole("button", { name: "Notifications (1 unread)" })).toBeInTheDocument();
  });
});
