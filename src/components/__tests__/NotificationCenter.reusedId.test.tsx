/**
 * 觸發紀錄的 id 會重用（資料庫沒有 AUTOINCREMENT）：舊的那則刪掉後，新警報可能拿到同一個 id。
 * 通知中心、useNotifications、輪詢查詢與 toast 用真的，API 與系統通知換成假的。
 * 假後端記得目前這個 id 屬於哪一則（看觸發時間），確認時對不上就回「已經不在」，和正式後端一樣。
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
import { STORAGE_KEYS } from "../../constants/storage";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    listTriggeredAlerts: vi.fn(),
    acknowledgeTriggeredAlert: vi.fn(),
  };
});

const { mockOSNotification } = vi.hoisted(() => ({
  mockOSNotification: {
    isGranted: false,
    isLoading: false,
    requestNotificationPermission: vi.fn(),
    sendOSNotification: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("../../hooks/useOSNotification", () => ({ useOSNotification: () => mockOSNotification }));

import { listTriggeredAlerts, acknowledgeTriggeredAlert } from "../../api/client";

function makeAlert(overrides: Partial<TriggeredAlert>): TriggeredAlert {
  return {
    id: 42,
    rule_id: 7,
    rule_name: "Old rule",
    repo_id: 3,
    repo_name: "facebook/react",
    signal_type: "velocity",
    signal_value: 31,
    threshold: 30,
    operator: ">",
    triggered_at: "2026-11-25T00:00:00.123456+00:00",
    acknowledged: false,
    acknowledged_at: null,
    ...overrides,
  };
}

/** 假後端目前的觸發紀錄（id 42 一次只屬於一則） */
let server: TriggeredAlert[];
let client: QueryClient;

/** 舊的那則（規則刪掉時連帶刪掉）換成拿到同一個 id 的新警報 */
function reuseId42ForANewAlert() {
  server = [
    makeAlert({
      rule_id: 8,
      rule_name: "New rule",
      triggered_at: "2026-11-25T01:00:00.654321+00:00",
    }),
  ];
}

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
}

describe("NotificationCenter when an alert id is reused", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockOSNotification.isGranted = false;
    server = [makeAlert({})];
    vi.mocked(listTriggeredAlerts).mockImplementation(() => Promise.resolve(server));
    vi.mocked(acknowledgeTriggeredAlert).mockImplementation((id, triggeredAt) => {
      const row = server.find((a) => a.id === id);
      if (!row || (triggeredAt !== undefined && triggeredAt !== row.triggered_at)) {
        return Promise.reject(new ApiError(404, "Alert not found", "TRIGGERED_ALERT_NOT_FOUND"));
      }
      server = server.map((a) =>
        a === row ? { ...a, acknowledged: true, acknowledged_at: "2026-11-25T00:30:00+00:00" } : a
      );
      return Promise.resolve({ status: "acknowledged", id });
    });
  });

  afterEach(() => {
    client.clear();
  });

  it("shows the new alert as unread even though the old one with that id was read", async () => {
    const user = userEvent.setup();
    renderCenter();
    await user.click(await screen.findByRole("button", { name: "Notifications (1 unread)" }));
    await user.click(screen.getByRole("button", { name: /Old rule/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
    });

    reuseId42ForANewAlert();
    await readTheListAgain();

    expect(
      await screen.findByRole("button", { name: "Notifications (1 unread)" })
    ).toBeInTheDocument();
  });

  it("does not remember reads in local storage", async () => {
    const user = userEvent.setup();
    renderCenter();
    await user.click(await screen.findByRole("button", { name: "Notifications (1 unread)" }));
    await user.click(screen.getByRole("button", { name: /Old rule/ }));
    await waitFor(() => {
      expect(acknowledgeTriggeredAlert).toHaveBeenCalledTimes(1);
    });

    // 已讀看後端的 acknowledged_at；本機記的話，之後拿到同一個 id 的新警報會被當成已讀
    expect(localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS_READ)).toBeNull();
  });

  it("sends a system notification for the new alert that reuses the id", async () => {
    mockOSNotification.isGranted = true;
    renderCenter();
    await screen.findByRole("button", { name: "Notifications (1 unread)" });
    expect(mockOSNotification.sendOSNotification).not.toHaveBeenCalled();

    reuseId42ForANewAlert();
    await readTheListAgain();

    await waitFor(() => {
      expect(mockOSNotification.sendOSNotification).toHaveBeenCalledTimes(1);
    });
  });

  it("does not acknowledge the new alert when the old notification is clicked", async () => {
    const user = userEvent.setup();
    renderCenter();
    await user.click(await screen.findByRole("button", { name: "Notifications (1 unread)" }));
    // 鈴鐺還列著舊的那則時，後端的 id 42 已經是新警報
    reuseId42ForANewAlert();

    await user.click(screen.getByRole("button", { name: /Old rule/ }));

    await waitFor(() => {
      expect(acknowledgeTriggeredAlert).toHaveBeenCalledWith(
        42,
        "2026-11-25T00:00:00.123456+00:00"
      );
    });
    expect(server[0].acknowledged).toBe(false);
    // 重讀之後列出的是新警報，未讀（點通知會關掉下拉，重新打開來看）
    await user.click(await screen.findByRole("button", { name: "Notifications (1 unread)" }));
    const dropdown = screen.getByRole("region", { name: "Notifications" });
    expect(within(dropdown).getByText("New rule")).toBeInTheDocument();
    expect(within(dropdown).queryByText("Old rule")).not.toBeInTheDocument();
  });
});
