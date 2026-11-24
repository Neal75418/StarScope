/**
 * 設定頁的警報規則編輯框：警報相關的 useAlertRules、AlertRuleForm、AlertRuleList 用真的，
 * API、toast、系統通知與其他設定區塊換成假的。
 * 框裡改到一半的內容要撐過設定頁重新渲染（存檔失敗、開關別條規則、捲動換區段）；換編輯別條規則時才換成那條的內容。
 * 正在編輯的那一條，清單上的開關與刪除鎖住，取消或換編輯別條時解開。
 */

import { createElement } from "react";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "../../lib/react-query";
import type { AlertRule, RepoWithSignals } from "../../api/client";
import { ApiError } from "../../api/types";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    listAlertRules: vi.fn(),
    listSignalTypes: vi.fn(),
    getRepos: vi.fn(),
    updateAlertRule: vi.fn(),
    deleteAlertRule: vi.fn(),
  };
});

// 正式版的 useToast 回傳 useMemo 包住的固定物件：這裡也固定，否則每次渲染 hook 的 callback 都換身分
const { mockToast, mockOSNotification } = vi.hoisted(() => ({
  mockToast: {
    addToast: vi.fn(),
    dismissToast: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
  mockOSNotification: {
    isGranted: false,
    isLoading: false,
    requestNotificationPermission: vi.fn(),
    sendOSNotification: vi.fn(),
  },
}));

vi.mock("../../components/Toast", () => ({ useToast: () => mockToast }));

vi.mock("../../hooks/useOSNotification", () => ({ useOSNotification: () => mockOSNotification }));

vi.mock("../../components/motion", () => ({
  AnimatedPage: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

// 警報以外的區塊各自會打 API，這裡用不到：逐檔換掉（不 mock barrel，表單與清單要用真的）
vi.mock("../../components/GitHubConnection", () => ({ GitHubConnection: () => null }));
vi.mock("../../components/settings/ImportSection", () => ({ ImportSection: () => null }));
vi.mock("../../components/settings/StarSyncSection", () => ({ StarSyncSection: () => null }));
vi.mock("../../components/settings/ArchivedRepos", () => ({ ArchivedRepos: () => null }));
vi.mock("../../components/settings/DataManagementSection", () => ({
  DataManagementSection: () => null,
}));
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

import {
  listAlertRules,
  listSignalTypes,
  getRepos,
  updateAlertRule,
  deleteAlertRule,
} from "../../api/client";
import { Settings } from "../Settings";

function makeRule(overrides: Partial<AlertRule>): AlertRule {
  return {
    id: 1,
    name: "Rule A",
    description: "old desc",
    repo_id: 3,
    repo_name: "facebook/react",
    signal_type: "velocity",
    operator: ">",
    threshold: 10,
    enabled: true,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    ...overrides,
  };
}

const ruleA = makeRule({});
const ruleB = makeRule({
  id: 2,
  name: "Rule B",
  description: "b desc",
  repo_id: null,
  repo_name: null,
});

function renderSettings() {
  const client = createTestQueryClient();
  return render(createElement(QueryClientProvider, { client }, <Settings />));
}

async function openEditFor(user: ReturnType<typeof userEvent.setup>, ruleName: string) {
  await user.click(await screen.findByRole("button", { name: `Edit ${ruleName}` }));
  return screen.getByLabelText<HTMLInputElement>(/Alert Name|警報名稱/);
}

describe("Settings alert rule edit form", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listAlertRules).mockResolvedValue([ruleA, ruleB]);
    vi.mocked(listSignalTypes).mockResolvedValue([
      { type: "velocity", name: "Velocity", description: "Star velocity" },
    ]);
    vi.mocked(getRepos).mockResolvedValue({
      repos: [{ id: 3, full_name: "facebook/react" } as RepoWithSignals],
      total: 1,
    } as Awaited<ReturnType<typeof getRepos>>);
  });

  it("keeps the edits in the form when saving them fails", async () => {
    const user = userEvent.setup();
    vi.mocked(updateAlertRule).mockRejectedValue(new Error("boom"));
    renderSettings();

    await openEditFor(user, "Rule A");
    const allRepos = screen.getByRole("radio", { name: /All Repositories|全部儲存庫/ });
    await user.click(allRepos);
    await user.click(screen.getByRole("button", { name: /^(Save|儲存)$/ }));

    await waitFor(() => {
      expect(updateAlertRule).toHaveBeenCalledTimes(1);
    });
    // 存檔結束（按鈕從「載入中」變回「儲存」）之後，框裡還是剛選的「全部儲存庫」
    await screen.findByRole("button", { name: /^(Save|儲存)$/ });
    expect(screen.getByRole("radio", { name: /All Repositories|全部儲存庫/ })).toBeChecked();
  });

  it("keeps the typed description when another rule is switched on or off", async () => {
    const user = userEvent.setup();
    vi.mocked(updateAlertRule).mockResolvedValue(ruleB);
    renderSettings();

    await openEditFor(user, "Rule A");
    const description = screen.getByLabelText<HTMLTextAreaElement>(/Description|描述/);
    await user.clear(description);
    await user.type(description, "typed new");
    await user.click(screen.getByRole("button", { name: "Disable Rule B" }));

    await waitFor(() => {
      expect(updateAlertRule).toHaveBeenCalledWith(2, { enabled: false });
    });
    // 樂觀更新已經畫上清單（Rule B 的鈕變成「啟用」），編輯框也跟著重新渲染過
    await screen.findByRole("button", { name: "Enable Rule B" });
    expect(screen.getByLabelText<HTMLTextAreaElement>(/Description|描述/)).toHaveValue("typed new");
  });

  it("keeps the typed description when the page is scrolled to another section", async () => {
    // jsdom 沒有 IntersectionObserver：換成記下回呼的假物件，手動觸發「捲到了某個區段」
    const callbacks = new Map<string, IntersectionObserverCallback>();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(private readonly callback: IntersectionObserverCallback) {}
        observe(el: Element) {
          callbacks.set(el.id, this.callback);
        }
        disconnect() {}
      }
    );
    const user = userEvent.setup();
    renderSettings();

    await openEditFor(user, "Rule A");
    const description = screen.getByLabelText<HTMLTextAreaElement>(/Description|描述/);
    await user.clear(description);
    await user.type(description, "typed new");
    const onAbout = callbacks.get("about");
    expect(onAbout).toBeDefined();
    act(() => {
      onAbout?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    // 側欄導覽跟著換到「關於」＝設定頁確實重新渲染過
    const nav = screen.getByRole("navigation");
    expect(within(nav).getByRole("button", { current: true })).toHaveTextContent(/About|關於/);
    expect(screen.getByLabelText<HTMLTextAreaElement>(/Description|描述/)).toHaveValue("typed new");
  });

  it("shows the other rule once it is opened for editing", async () => {
    const user = userEvent.setup();
    renderSettings();

    const name = await openEditFor(user, "Rule A");
    expect(name).toHaveValue("Rule A");

    await user.click(screen.getByRole("button", { name: "Edit Rule B" }));

    expect(screen.getByLabelText(/Alert Name|警報名稱/)).toHaveValue("Rule B");
    expect(screen.getByLabelText(/Description|描述/)).toHaveValue("b desc");
    expect(screen.getByRole("radio", { name: /All Repositories|全部儲存庫/ })).toBeChecked();
  });

  it("shows the rule once it is opened for editing while a new rule is being written", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole("button", { name: /^(Create Alert|建立警報)$/ }));
    await user.type(screen.getByLabelText(/Alert Name|警報名稱/), "draft");
    await user.click(screen.getByRole("button", { name: "Edit Rule A" }));

    expect(screen.getByLabelText(/Alert Name|警報名稱/)).toHaveValue("Rule A");
    expect(screen.getByLabelText(/Description|描述/)).toHaveValue("old desc");
  });

  it("keeps the rule being edited from being switched off in the list, so saving keeps what the form shows", async () => {
    // 編輯框整包送出、啟用送的是框裡勾選框的值：清單上還能停用同一條的話，存檔會把它改回啟用
    const user = userEvent.setup();
    vi.mocked(updateAlertRule).mockResolvedValue(ruleA);
    renderSettings();

    await openEditFor(user, "Rule A");
    const disableA = screen.getByRole("button", { name: "Disable Rule A" });
    expect(disableA).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete Rule A" })).toBeDisabled();
    await user.click(disableA);
    await user.click(screen.getByRole("button", { name: /^(Save|儲存)$/ }));

    await waitFor(() => {
      expect(updateAlertRule).toHaveBeenCalledTimes(1);
    });
    // 點鎖住的鈕不會送出停用：只送了存檔那一次，啟用照框裡勾選框的值（打開時是勾著的）
    expect(updateAlertRule).not.toHaveBeenCalledWith(1, { enabled: false });
    expect(updateAlertRule).toHaveBeenCalledWith(1, expect.objectContaining({ enabled: true }));
  });

  it("saves the rule switched off once Enabled is unticked in the form", async () => {
    // 編輯中啟用與否只由框裡的勾選框決定：取消勾選後存檔要送出停用
    const user = userEvent.setup();
    vi.mocked(updateAlertRule).mockResolvedValue(ruleA);
    renderSettings();

    await openEditFor(user, "Rule A");
    await user.click(screen.getByRole("checkbox", { name: /^(Enabled|啟用)$/ }));
    await user.click(screen.getByRole("button", { name: /^(Save|儲存)$/ }));

    await waitFor(() => {
      expect(updateAlertRule).toHaveBeenCalledWith(1, expect.objectContaining({ enabled: false }));
    });
    // 只認存檔那一次：清單上的開關送的 (1, { enabled: false }) 也符合上面的比對
    expect(updateAlertRule).toHaveBeenCalledTimes(1);
  });

  it("saves a switched-off rule still switched off when nothing is changed", async () => {
    // 打開時勾選框要是規則真正的狀態：寫死成勾著的話，什麼都不動就存檔會把已停用的規則重新啟用
    const user = userEvent.setup();
    vi.mocked(listAlertRules).mockResolvedValue([{ ...ruleA, enabled: false }, ruleB]);
    vi.mocked(updateAlertRule).mockResolvedValue(ruleA);
    renderSettings();

    await openEditFor(user, "Rule A");
    expect(screen.getByRole("checkbox", { name: /^(Enabled|啟用)$/ })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: /^(Save|儲存)$/ }));

    await waitFor(() => {
      expect(updateAlertRule).toHaveBeenCalledTimes(1);
    });
    expect(updateAlertRule).toHaveBeenCalledWith(1, expect.objectContaining({ enabled: false }));
  });

  it("unlocks the rule once editing is cancelled", async () => {
    const user = userEvent.setup();
    renderSettings();

    await openEditFor(user, "Rule A");
    await user.click(screen.getByRole("button", { name: /^(Cancel|取消)$/ }));

    expect(screen.getByRole("button", { name: "Disable Rule A" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Delete Rule A" })).toBeEnabled();
  });

  it("moves the lock to the rule that is opened for editing next", async () => {
    const user = userEvent.setup();
    renderSettings();

    await openEditFor(user, "Rule A");
    await user.click(screen.getByRole("button", { name: "Edit Rule B" }));

    expect(screen.getByRole("button", { name: "Disable Rule A" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Disable Rule B" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete Rule B" })).toBeDisabled();
  });

  it("closes the edit form and says the changes were not saved when the rule is no longer there", async () => {
    // 編輯中被別的操作弄不見（重設資料、永久刪除儲存庫、它看的儲存庫被封存）：不要留著一個存不進去的框
    const user = userEvent.setup();
    vi.mocked(updateAlertRule).mockRejectedValue(
      new ApiError(404, "Rule not found", "ALERT_RULE_NOT_FOUND")
    );
    renderSettings();

    await openEditFor(user, "Rule A");
    const loadsBeforeSave = vi.mocked(listAlertRules).mock.calls.length;
    await user.click(screen.getByRole("button", { name: /^(Save|儲存)$/ }));

    await waitFor(() => {
      expect(screen.queryByLabelText(/Alert Name|警報名稱/)).toBeNull();
    });
    expect(mockToast.warning).toHaveBeenCalledWith(expect.stringMatching(/^Not saved/));
    expect(mockToast.error).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(vi.mocked(listAlertRules).mock.calls.length).toBeGreaterThan(loadsBeforeSave);
    });
  });

  it("closes the delete prompt when the rule is no longer there", async () => {
    // 刪除的確認框也不要留著一個怎麼按都失敗的確認鈕
    const user = userEvent.setup();
    vi.mocked(deleteAlertRule).mockRejectedValue(
      new ApiError(404, "Rule not found", "ALERT_RULE_NOT_FOUND")
    );
    renderSettings();

    await user.click(await screen.findByRole("button", { name: "Delete Rule B" }));
    const prompt = await screen.findByRole("alertdialog");
    await user.click(within(prompt).getByRole("button", { name: /^(Delete|刪除)$/ }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(deleteAlertRule).toHaveBeenCalledWith(2);
    expect(mockToast.info).toHaveBeenCalledWith(
      expect.stringMatching(/^This alert rule is no longer in the list/)
    );
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("keeps the delete prompt open when deleting fails, so it can be tried again", async () => {
    const user = userEvent.setup();
    vi.mocked(deleteAlertRule).mockRejectedValue(new ApiError(500, "boom internal"));
    renderSettings();

    await user.click(await screen.findByRole("button", { name: "Delete Rule B" }));
    const prompt = await screen.findByRole("alertdialog");
    await user.click(within(prompt).getByRole("button", { name: /^(Delete|刪除)$/ }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});
