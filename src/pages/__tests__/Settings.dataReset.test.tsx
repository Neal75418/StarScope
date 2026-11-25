/**
 * 設定頁重設資料之後，同一頁上的區塊要換成重設後的內容：資料管理、警報區塊與 toast 用真的，
 * API、系統通知與其他設定區塊換成假的。
 * 重設之後沒有東西會讓警報區塊重新渲染（toast 的 API 是 useMemo 固定的物件、沒有捲動換區段），
 * 所以清單要靠查詢本身重讀才會更新。假 API 記得後端重設了沒，重設前讀的與重設後讀的回應不同。
 */

import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "../../components/Toast";
import { queryClient as appQueryClient } from "../../lib/react-query";
import type { AlertRule, RepoWithSignals } from "../../api/client";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    listAlertRules: vi.fn(),
    listSignalTypes: vi.fn(),
    getRepos: vi.fn(),
    resetAllData: vi.fn(),
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

vi.mock("../../components/motion", () => ({
  AnimatedPage: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

// 資料管理與警報以外的區塊各自會打 API，這裡用不到：逐檔換掉（不 mock barrel）
vi.mock("../../components/GitHubConnection", () => ({ GitHubConnection: () => null }));
vi.mock("../../components/settings/ImportSection", () => ({ ImportSection: () => null }));
vi.mock("../../components/settings/StarSyncSection", () => ({ StarSyncSection: () => null }));
vi.mock("../../components/settings/ArchivedRepos", () => ({ ArchivedRepos: () => null }));
vi.mock("../../components/settings/AboutSection", () => ({ AboutSection: () => null }));
vi.mock("../../components/settings/ScheduledRefreshSection", () => ({
  ScheduledRefreshSection: () => null,
}));
vi.mock("../../components/settings/SnapshotRetentionSection", () => ({
  SnapshotRetentionSection: () => null,
}));
vi.mock("../../components/settings/SignalThresholdsSection", () => ({
  SignalThresholdsSection: () => null,
}));
vi.mock("../../components/settings/InterestsSection", () => ({ InterestsSection: () => null }));
vi.mock("../../components/settings/DiagnosticsSection", () => ({
  DiagnosticsSection: () => null,
}));

import { listAlertRules, listSignalTypes, getRepos, resetAllData } from "../../api/client";
import { Settings } from "../Settings";

const ruleA: AlertRule = {
  id: 1,
  name: "Rule A",
  description: null,
  repo_id: null,
  repo_name: null,
  signal_type: "velocity",
  operator: ">",
  threshold: 10,
  enabled: true,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
};

let client: QueryClient;
/** 假後端的狀態：resetAllData 要處理 20ms，回應送出時才算重設完成，處理中讀的仍是重設前的資料 */
let serverReset: boolean;

/** 規則清單：重設前是 Rule A，重設後由各測試決定 */
function rulesOnServer(afterReset: () => Promise<AlertRule[]>) {
  vi.mocked(listAlertRules).mockImplementation(() =>
    serverReset ? afterReset() : Promise.resolve([ruleA])
  );
}

/** 快取設定與正式版一致（staleTime、gcTime），只關掉重試 */
function renderSettings() {
  const defaults = appQueryClient.getDefaultOptions();
  client = new QueryClient({
    defaultOptions: { ...defaults, queries: { ...defaults.queries, retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Settings />
      </ToastProvider>
    </QueryClientProvider>
  );
}

async function resetAll(user: ReturnType<typeof userEvent.setup>) {
  const section = screen.getByTestId("data-management-section");
  await user.click(within(section).getByRole("button", { name: /Reset All|重置所有/ }));
  const dialog = await screen.findByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: /Reset All Data|重置所有資料/ }));
}

describe("Settings after resetting all data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serverReset = false;
    vi.mocked(listSignalTypes).mockResolvedValue([
      { type: "velocity", name: "Velocity", description: "Star velocity" },
    ]);
    vi.mocked(getRepos).mockResolvedValue({ repos: [] as RepoWithSignals[], total: 0 } as Awaited<
      ReturnType<typeof getRepos>
    >);
    vi.mocked(resetAllData).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            serverReset = true;
            resolve({ status: "reset", deleted_repos: 1 });
          }, 20);
        })
    );
  });

  afterEach(() => {
    client.clear();
  });

  it("shows the alert rules the server has after the reset", async () => {
    rulesOnServer(() => Promise.resolve([]));
    const user = userEvent.setup();
    renderSettings();
    await screen.findByText("Rule A");

    await resetAll(user);

    expect(await screen.findByText("No alert rules configured.")).toBeInTheDocument();
    expect(screen.queryByText("Rule A")).not.toBeInTheDocument();
    expect(listAlertRules).toHaveBeenCalledTimes(2);
  });

  it("does not show the rules from before the reset while reading them again", async () => {
    rulesOnServer(() => new Promise(() => {}));
    const user = userEvent.setup();
    renderSettings();
    await screen.findByText("Rule A");

    await resetAll(user);

    await waitFor(() => {
      expect(screen.queryByText("Rule A")).not.toBeInTheDocument();
    });
    // 還沒讀到：說「載入中」，不說「尚未設定警報規則」
    const alertsSection = screen.getByTestId("alerts-section");
    expect(within(alertsSection).getByText("Loading...")).toBeInTheDocument();
    expect(within(alertsSection).queryByText("No alert rules configured.")).not.toBeInTheDocument();
    expect(listAlertRules).toHaveBeenCalledTimes(2);
  });

  it("says the reset is done without waiting for the page to be read again", async () => {
    rulesOnServer(() => new Promise(() => {}));
    const user = userEvent.setup();
    renderSettings();
    await screen.findByText("Rule A");

    await resetAll(user);

    expect(await screen.findByText("All data has been reset")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
