/**
 * 改到已觸發警報的寫入之後，鈴鐺與儀表板都要馬上跟上，不等鈴鐺下一輪輪詢（一分鐘）、不等儀表板的快取過期（5 分鐘）。
 * 通知中心、儀表板的 hook、設定頁的警報規則與「已封存」區塊用真的，API 換成記得狀態的假後端；快取用正式版的設定。
 * 頁面照 app 的樣子換：鈴鐺一直在，儀表板與設定頁一次只有一個掛著。
 * 背景排程觸發的新警報沒有 app 裡的寫入：由鈴鐺的輪詢帶著儀表板重讀（最後一組）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ToastProvider } from "../Toast";
import { NotificationCenter } from "../NotificationCenter";
import { ArchivedRepos } from "../settings/ArchivedRepos";
import {
  invalidateTriggeredAlerts,
  queryClient as appQueryClient,
  queryKeys,
} from "../../lib/react-query";
import { useDashboard } from "../../hooks/useDashboard";
import { useAlertRules } from "../../hooks/useAlertRules";
import type {
  AlertRule,
  DiagnosticsResponse,
  RepoWithSignals,
  SignalSummary,
  TriggeredAlert,
} from "../../api/types";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    listTriggeredAlerts: vi.fn(),
    acknowledgeTriggeredAlert: vi.fn(),
    dismissTriggeredAlert: vi.fn(),
    listAlertRules: vi.fn(),
    listSignalTypes: vi.fn(),
    createAlertRule: vi.fn(),
    deleteAlertRule: vi.fn(),
    checkAlerts: vi.fn(),
    getRepos: vi.fn(),
    listEarlySignals: vi.fn(),
    getSignalSummary: vi.fn(),
    getDiagnostics: vi.fn(),
    getArchivedRepos: vi.fn(),
    restarRepo: vi.fn(),
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
vi.mock("../../contexts/WatchlistContext", () => ({
  useWatchlistActions: () => ({ showToast: vi.fn() }),
}));

import * as api from "../../api/client";

const rule: AlertRule = {
  id: 7,
  name: "Star spike",
  description: null,
  repo_id: null,
  repo_name: null,
  signal_type: "velocity",
  operator: ">",
  threshold: 30,
  enabled: true,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
};

function makeAlert(id: number, repoId: number): TriggeredAlert {
  return {
    id,
    rule_id: rule.id,
    rule_name: rule.name,
    repo_id: repoId,
    repo_name: repoId === 3 ? "facebook/react" : "vuejs/core",
    signal_type: "velocity",
    signal_value: 31,
    threshold: 30,
    operator: ">",
    triggered_at: `2026-11-25T00:00:${String(id).padStart(2, "0")}Z`,
    acknowledged: false,
    acknowledged_at: null,
  };
}

const archivedRepo = {
  id: 3,
  full_name: "facebook/react",
} as RepoWithSignals;

const summary: SignalSummary = {
  total_active: 0,
  by_type: {},
  by_severity: {},
  repos_with_signals: 0,
  snapshot_days_covered: 40,
};

/** 假後端：規則刪了觸發紀錄跟著刪，封存的 repo 的警報不列 */
let backend: { rules: AlertRule[]; alerts: TriggeredAlert[]; archived: Set<number> };

function listedAlerts() {
  return backend.alerts
    .filter((a) => !backend.archived.has(a.repo_id))
    .map((a) => ({ ...a }))
    .reverse();
}

function setupBackend() {
  vi.mocked(api.listTriggeredAlerts).mockImplementation(() => Promise.resolve(listedAlerts()));
  vi.mocked(api.acknowledgeTriggeredAlert).mockImplementation((id) => {
    for (const a of backend.alerts) if (a.id === id) a.acknowledged = true;
    return Promise.resolve({ status: "acknowledged", id });
  });
  vi.mocked(api.listAlertRules).mockImplementation(() =>
    Promise.resolve(backend.rules.map((r) => ({ ...r })))
  );
  vi.mocked(api.listSignalTypes).mockResolvedValue([
    { type: "velocity", name: "Velocity", description: "" },
  ]);
  vi.mocked(api.createAlertRule).mockImplementation((data) => {
    const created: AlertRule = {
      ...rule,
      ...data,
      description: data.description ?? null,
      repo_id: data.repo_id ?? null,
    };
    backend.rules.push(created);
    return Promise.resolve(created);
  });
  vi.mocked(api.deleteAlertRule).mockImplementation((id) => {
    backend.rules = backend.rules.filter((r) => r.id !== id);
    backend.alerts = backend.alerts.filter((a) => a.rule_id !== id);
    return Promise.resolve({ status: "deleted", id });
  });
  vi.mocked(api.checkAlerts).mockImplementation(() => {
    const triggered = makeAlert(backend.alerts.length + 41, 3);
    backend.alerts.push(triggered);
    return Promise.resolve({
      status: "checked",
      triggered_count: 1,
      triggered: [{ id: triggered.id, rule_id: rule.id, repo_id: 3, signal_value: 31 }],
      failed_rule_count: 0,
    });
  });
  vi.mocked(api.getRepos).mockResolvedValue({ repos: [], total: 0 });
  vi.mocked(api.listEarlySignals).mockResolvedValue({ signals: [], total: 0 });
  vi.mocked(api.getSignalSummary).mockResolvedValue(summary);
  vi.mocked(api.getDiagnostics).mockResolvedValue({
    last_fetch_success: null,
    fetch_in_progress: false,
  } as DiagnosticsResponse);
  vi.mocked(api.getArchivedRepos).mockImplementation(() => {
    const repos = backend.archived.has(archivedRepo.id) ? [archivedRepo] : [];
    return Promise.resolve({ repos, total: repos.length });
  });
  vi.mocked(api.restarRepo).mockImplementation((id) => {
    backend.archived.delete(id);
    return Promise.resolve();
  });
}

/** 儀表板「啟用中的警報」那張卡片顯示的值 */
function DashboardPage() {
  const dashboard = useDashboard();
  // 跟頁面一樣看 load：還沒全部讀到過就不顯示數字
  if (!dashboard.load.ready) return <p data-testid="active-alerts">loading</p>;
  return (
    <p data-testid="active-alerts">
      {dashboard.hasAlertRules ? String(dashboard.stats.activeAlerts) : "no rules yet"}
    </p>
  );
}

const ruleToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
let rulesPage: ReturnType<typeof useAlertRules> | null;

function rules() {
  if (rulesPage === null) throw new Error("the settings page is not shown");
  return rulesPage;
}

/** 設定頁的警報規則區塊（只接操作，不畫表單）與「已封存」區塊 */
function SettingsPage() {
  rulesPage = useAlertRules(ruleToast);
  return (
    <>
      <p data-testid="rules-loaded">{rulesPage.rulesLoad.ready ? "ready" : "loading"}</p>
      <ArchivedRepos />
    </>
  );
}

let client: QueryClient;

function shell(page: ReactNode) {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <NotificationCenter onNavigate={vi.fn()} />
        {page}
      </ToastProvider>
    </QueryClientProvider>
  );
}

async function dashboardShows(text: string) {
  await waitFor(() => {
    expect(screen.getByTestId("active-alerts")).toHaveTextContent(text);
  });
}

async function openSettings(rerender: (ui: ReactNode) => void) {
  rerender(shell(<SettingsPage />));
  await waitFor(() => {
    expect(screen.getByTestId("rules-loaded")).toHaveTextContent("ready");
  });
}

describe("NotificationCenter and the dashboard after writes that change triggered alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    rulesPage = null;
    // 正式版的快取設定，只關掉重試：儀表板在 5 分鐘內掛回來不會自己重讀
    const defaults = appQueryClient.getDefaultOptions();
    client = new QueryClient({
      defaultOptions: { ...defaults, queries: { ...defaults.queries, retry: false } },
    });
    backend = { rules: [{ ...rule }], alerts: [makeAlert(41, 3)], archived: new Set() };
    setupBackend();
  });

  afterEach(() => {
    client.clear();
  });

  it("drops the alerts of a deleted rule from the bell and the dashboard right away", async () => {
    // 另一條規則留著：儀表板要顯示警報數，不是「未設定規則」（那是規則清單，另一份快取）
    backend.rules.push({ ...rule, id: 8, name: "Fork surge" });
    const { rerender } = render(shell(<DashboardPage />));
    await dashboardShows("1");
    expect(
      await screen.findByRole("button", { name: "Notifications (1 unread)" })
    ).toBeInTheDocument();

    await openSettings(rerender);
    act(() => {
      rules().openDeleteConfirm(rule.id);
    });
    await act(async () => {
      await rules().confirmDelete();
    });
    expect(api.deleteAlertRule).toHaveBeenCalledWith(rule.id);

    expect(await screen.findByRole("button", { name: "Notifications" })).toBeInTheDocument();
    rerender(shell(<DashboardPage />));
    await dashboardShows("0");
  });

  it("counts the first rule on the dashboard once it is created", async () => {
    // 儀表板的卡片說「未設定規則」、點下去到設定頁建一條，回來時卡片要換成警報數
    backend = { rules: [], alerts: [], archived: new Set() };
    const { rerender } = render(shell(<DashboardPage />));
    await dashboardShows("no rules yet");

    await openSettings(rerender);
    await act(async () => {
      await rules().handleCreate({
        name: rule.name,
        signal_type: rule.signal_type,
        operator: rule.operator,
        threshold: rule.threshold,
        enabled: true,
      });
    });

    rerender(shell(<DashboardPage />));
    await dashboardShows("0");
  });

  it("shows the alerts a manual check triggered in the bell and the dashboard right away", async () => {
    backend.alerts = [];
    const { rerender } = render(shell(<DashboardPage />));
    await dashboardShows("0");
    expect(await screen.findByRole("button", { name: "Notifications" })).toBeInTheDocument();

    await openSettings(rerender);
    await act(async () => {
      await rules().handleCheckNow();
    });

    expect(
      await screen.findByRole("button", { name: "Notifications (1 unread)" })
    ).toBeInTheDocument();
    rerender(shell(<DashboardPage />));
    await dashboardShows("1");
  });

  it("brings back the alerts of a repo tracked again in the bell and the dashboard right away", async () => {
    backend.archived = new Set([archivedRepo.id]);
    const { rerender } = render(shell(<DashboardPage />));
    await dashboardShows("0");
    expect(await screen.findByRole("button", { name: "Notifications" })).toBeInTheDocument();

    await openSettings(rerender);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId(`archived-restar-${archivedRepo.id}`));

    expect(
      await screen.findByRole("button", { name: "Notifications (1 unread)" })
    ).toBeInTheDocument();
    rerender(shell(<DashboardPage />));
    await dashboardShows("1");
  });

  it("lowers the dashboard's count when the alerts are read in the bell", async () => {
    render(shell(<DashboardPage />));
    await dashboardShows("1");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Notifications (1 unread)" }));
    const dropdown = screen.getByRole("region", { name: "Notifications" });

    await user.click(within(dropdown).getByRole("button", { name: "Mark all as read" }));

    await dashboardShows("0");
  });
});

/** 儀表板讀已觸發警報的次數（鈴鐺那份帶 excludeDismissed，儀表板的不帶） */
const dashboardReads = () =>
  vi.mocked(api.listTriggeredAlerts).mock.calls.filter(([, , , options]) => !options).length;

/** 鈴鐺的一輪輪詢：只重讀鈴鐺那份 */
async function bellPolls() {
  await act(async () => {
    await client.invalidateQueries({ queryKey: queryKeys.notifications.polling() });
  });
}

describe("the dashboard after the bell finds alerts triggered in the background", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    rulesPage = null;
    const defaults = appQueryClient.getDefaultOptions();
    client = new QueryClient({
      defaultOptions: { ...defaults, queries: { ...defaults.queries, retry: false } },
    });
    backend = { rules: [{ ...rule }], alerts: [makeAlert(41, 3)], archived: new Set() };
    setupBackend();
  });

  afterEach(() => {
    client.clear();
  });

  it("counts an alert the bell finds on its own poll while the dashboard is open", async () => {
    // 排程或背景收集器觸發的：app 裡沒有任何寫入，只有鈴鐺的輪詢讀得到
    render(shell(<DashboardPage />));
    await dashboardShows("1");
    expect(
      await screen.findByRole("button", { name: "Notifications (1 unread)" })
    ).toBeInTheDocument();

    backend.alerts.push(makeAlert(42, 3));
    await bellPolls();

    expect(
      await screen.findByRole("button", { name: "Notifications (2 unread)" })
    ).toBeInTheDocument();
    await dashboardShows("2");
  });

  it("counts an alert that arrives while the dashboard's first read is still on its way", async () => {
    // 那次讀取是新警報寫進資料庫之前送的：併進它的話，讀回的還是舊的
    let answerFirstRead: () => void = () => {};
    const listFromBackend = vi.mocked(api.listTriggeredAlerts).getMockImplementation();
    vi.mocked(api.listTriggeredAlerts).mockImplementation((...args) => {
      const isDashboard = !args[3];
      if (isDashboard && dashboardReads() === 1) {
        const snapshot = listedAlerts();
        return new Promise((resolve) => {
          answerFirstRead = () => resolve(snapshot);
        });
      }
      return listFromBackend ? listFromBackend(...args) : Promise.resolve([]);
    });
    render(shell(<DashboardPage />));
    expect(
      await screen.findByRole("button", { name: "Notifications (1 unread)" })
    ).toBeInTheDocument();

    backend.alerts.push(makeAlert(42, 3));
    await bellPolls();
    expect(
      await screen.findByRole("button", { name: "Notifications (2 unread)" })
    ).toBeInTheDocument();
    await act(async () => {
      answerFirstRead();
    });

    await dashboardShows("2");
  });

  /** 之後儀表板的每次讀取都先停住（讀的是送出當下的資料），回傳逐一放行的函式 */
  function holdDashboardReads() {
    const answers: (() => void)[] = [];
    const listFromBackend = vi.mocked(api.listTriggeredAlerts).getMockImplementation();
    vi.mocked(api.listTriggeredAlerts).mockImplementation((...args) => {
      if (!args[3]) {
        const snapshot = listedAlerts();
        return new Promise((resolve) => {
          answers.push(() => resolve(snapshot));
        });
      }
      return listFromBackend ? listFromBackend(...args) : Promise.resolve([]);
    });
    return answers;
  }

  it("still lets a re-read of both copies wait for the dashboard's new read", async () => {
    // app 裡的寫入兩份一起重讀、讀完才 resolve（invalidateTriggeredAlerts）。儀表板那次讀取還在路上時鈴鐺讀到新警報：
    // 要換成新的讀取，而且那次重讀要等到新的讀完，不能拿警報之前的那次結束
    render(shell(<DashboardPage />));
    await dashboardShows("1");
    expect(
      await screen.findByRole("button", { name: "Notifications (1 unread)" })
    ).toBeInTheDocument();
    const answers = holdDashboardReads();

    let done = false;
    let rereading: Promise<void> = Promise.resolve();
    await act(async () => {
      rereading = invalidateTriggeredAlerts(client).then(() => {
        done = true;
      });
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(answers).toHaveLength(1);
    backend.alerts.push(makeAlert(42, 3));
    await bellPolls();
    expect(
      await screen.findByRole("button", { name: "Notifications (2 unread)" })
    ).toBeInTheDocument();
    expect(answers).toHaveLength(2);

    await act(async () => {
      answers[0]();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(done).toBe(false);
    await act(async () => {
      answers[1]();
      await rereading;
    });
    await dashboardShows("2");
  });

  it("counts an alert that arrives while a read of the dashboard was still on its way when it was left", async () => {
    // 離開儀表板時那次讀取還在路上：沒掛著時 invalidate 不重讀，那次讀取回來會把「要重讀」清掉
    const { rerender } = render(shell(<DashboardPage />));
    await dashboardShows("1");
    expect(
      await screen.findByRole("button", { name: "Notifications (1 unread)" })
    ).toBeInTheDocument();
    const answers = holdDashboardReads();
    await act(async () => {
      void client.invalidateQueries({ queryKey: queryKeys.alerts.triggered() });
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(answers).toHaveLength(1);
    await openSettings(rerender);

    backend.alerts.push(makeAlert(42, 3));
    await bellPolls();
    expect(
      await screen.findByRole("button", { name: "Notifications (2 unread)" })
    ).toBeInTheDocument();
    await act(async () => {
      answers[0]();
      await new Promise((r) => setTimeout(r, 30));
    });

    rerender(shell(<DashboardPage />));
    await waitFor(() => {
      expect(answers.length).toBeGreaterThan(1);
    });
    await act(async () => {
      for (const answer of answers.slice(1)) answer();
    });
    await dashboardShows("2");
  });

  it("counts it when the dashboard opens again within five minutes", async () => {
    const { rerender } = render(shell(<DashboardPage />));
    await dashboardShows("1");
    await openSettings(rerender);

    backend.alerts.push(makeAlert(42, 3));
    await bellPolls();
    expect(
      await screen.findByRole("button", { name: "Notifications (2 unread)" })
    ).toBeInTheDocument();

    rerender(shell(<DashboardPage />));
    await dashboardShows("2");
  });

  it("does not read the dashboard again because of the bell's first read", async () => {
    // 第一次讀回只當基準：儀表板自己會讀
    render(shell(<DashboardPage />));
    await dashboardShows("1");
    expect(
      await screen.findByRole("button", { name: "Notifications (1 unread)" })
    ).toBeInTheDocument();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(dashboardReads()).toBe(1);
  });

  it("does not read the dashboard again when the poll finds nothing new", async () => {
    render(shell(<DashboardPage />));
    await dashboardShows("1");
    expect(
      await screen.findByRole("button", { name: "Notifications (1 unread)" })
    ).toBeInTheDocument();
    const before = dashboardReads();

    await bellPolls();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(dashboardReads()).toBe(before);
  });
});
