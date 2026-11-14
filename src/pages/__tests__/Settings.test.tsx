import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { Settings } from "../Settings";
import { createTestQueryClient } from "../../lib/react-query";

let mockAlertsReturn: Record<string, unknown>;

// noinspection JSUnusedGlobalSymbols
vi.mock("../../hooks/useAlertRules", () => ({
  useAlertRules: () => mockAlertsReturn,
}));

vi.mock("../../components/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("../../components/ConfirmDialog", () => ({
  ConfirmDialog: ({
    isOpen,
    onConfirm,
    onCancel,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    isOpen ? (
      <div data-testid="confirm-dialog">
        <button data-testid="confirm-btn" onClick={onConfirm}>
          Confirm
        </button>
        <button data-testid="cancel-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    ) : null,
}));

vi.mock("../../hooks/useOSNotification", () => ({
  useOSNotification: () => ({
    sendOSNotification: vi.fn(),
    isGranted: false,
    requestPermission: vi.fn(),
  }),
}));

// noinspection JSUnusedGlobalSymbols
vi.mock("../../components/GitHubConnection", () => ({
  GitHubConnection: () => <div data-testid="github-connection">GitHub Connection</div>,
}));

// noinspection JSUnusedGlobalSymbols
vi.mock("../../components/settings", () => ({
  DataManagementSection: () => <div data-testid="data-management-section">Data Management</div>,
  AboutSection: () => <div data-testid="about-section">About</div>,
  ScheduledRefreshSection: () => <div data-testid="scheduled-refresh-section">Refresh</div>,
  SnapshotRetentionSection: () => <div data-testid="snapshot-retention-section">Retention</div>,
  SignalThresholdsSection: () => <div data-testid="signal-thresholds-section">Thresholds</div>,
  InterestsSection: () => <div data-testid="interests-section">Interests</div>,
  ImportSection: () => <div data-testid="import-section">Import</div>,
  StarSyncSection: () => <div data-testid="star-sync-section">Star Sync</div>,
  ArchivedRepos: () => <div data-testid="archived-repos">Archived</div>,
  AlertRuleForm: ({
    isEditMode,
    onSubmit,
    onCancel,
  }: {
    isEditMode: boolean;
    onSubmit: () => void;
    onCancel: () => void;
  }) => (
    <div data-testid="alert-form">
      <span data-testid="form-mode">{isEditMode ? "edit" : "create"}</span>
      <button data-testid="form-submit" onClick={onSubmit}>
        Submit
      </button>
      <button data-testid="form-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  ),
  AlertRuleList: ({
    rules,
    onEdit,
    onDelete,
    onToggle,
  }: {
    rules: { id: number }[];
    onEdit: (id: number) => void;
    onDelete: (id: number) => void;
    onToggle: (id: number) => void;
  }) => (
    <div data-testid="alert-list">
      {rules.map((r: { id: number }) => (
        <div key={r.id} data-testid={`rule-${r.id}`}>
          <button data-testid={`edit-${r.id}`} onClick={() => onEdit(r.id)}>
            Edit
          </button>
          <button data-testid={`delete-${r.id}`} onClick={() => onDelete(r.id)}>
            Delete
          </button>
          <button data-testid={`toggle-${r.id}`} onClick={() => onToggle(r.id)}>
            Toggle
          </button>
        </div>
      ))}
    </div>
  ),
}));

vi.mock("../../components/motion", () => ({
  AnimatedPage: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

function renderWithClient(ui: ReactElement) {
  const client = createTestQueryClient();
  return render(createElement(QueryClientProvider, { client }, ui));
}

describe("Settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAlertsReturn = {
      rules: [],
      isLoading: false,
      isSubmitting: false,
      editingRule: null,
      editingRuleData: null,
      initialAlertRule: { name: "default" },
      signalTypes: [],
      repos: [],
      rulesLoad: { ready: true, failed: false, inProgress: false, retry: vi.fn() },
      dataLoad: { ready: true, failed: false, inProgress: false, retry: vi.fn() },
      deleteConfirm: { isOpen: false },
      handleCreate: vi.fn(),
      handleUpdate: vi.fn(),
      handleToggle: vi.fn(),
      handleEdit: vi.fn(),
      handleCancelEdit: vi.fn(),
      handleCheckNow: vi.fn().mockResolvedValue(undefined),
      openDeleteConfirm: vi.fn(),
      confirmDelete: vi.fn(),
      closeDeleteConfirm: vi.fn(),
    };
  });

  it("keeps every section on screen while the alert data is still loading", () => {
    // 警報資料只是其中一個區塊：整頁換成「載入中」的話，其他區塊打到一半的字、捲動位置都會不見
    mockAlertsReturn.isLoading = true;
    mockAlertsReturn.rulesLoad = { ready: false, failed: false, inProgress: true, retry: vi.fn() };
    mockAlertsReturn.dataLoad = { ready: false, failed: false, inProgress: true, retry: vi.fn() };
    renderWithClient(<Settings />);

    expect(screen.getByTestId("github-section")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("alerts-section")).getByText("Loading...")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("alert-list")).not.toBeInTheDocument();
  });

  it("renders all sections when loaded", () => {
    renderWithClient(<Settings />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByTestId("github-section")).toBeInTheDocument();
    expect(screen.getByTestId("import-section")).toBeInTheDocument();
    expect(screen.getByTestId("star-sync-section")).toBeInTheDocument();
    expect(screen.getByTestId("archived-repos")).toBeInTheDocument();
    expect(screen.getByTestId("alerts-section")).toBeInTheDocument();
  });

  it("renders alert rules section with create button", () => {
    renderWithClient(<Settings />);
    expect(screen.getByRole("heading", { name: "Alert Rules" })).toBeInTheDocument();
    expect(screen.getByText("Create Alert")).toBeInTheDocument();
  });

  it("shows Check Now button when form is not visible", () => {
    renderWithClient(<Settings />);
    expect(screen.getByText("Check Now")).toBeInTheDocument();
  });

  it("calls handleCheckNow when Check Now is clicked", async () => {
    const user = userEvent.setup();
    renderWithClient(<Settings />);
    await user.click(screen.getByText("Check Now"));
    expect(mockAlertsReturn.handleCheckNow).toHaveBeenCalled();
  });

  it("shows alert form in create mode when Create Rule is clicked", async () => {
    const user = userEvent.setup();
    renderWithClient(<Settings />);
    await user.click(screen.getByText("Create Alert"));
    expect(screen.getByTestId("alert-form")).toBeInTheDocument();
    expect(screen.getByTestId("form-mode")).toHaveTextContent("create");
  });

  it("hides Create Rule and Check Now buttons when form is visible", async () => {
    const user = userEvent.setup();
    renderWithClient(<Settings />);
    await user.click(screen.getByText("Create Alert"));
    expect(screen.queryByText("Create Alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Check Now")).not.toBeInTheDocument();
  });

  it("shows alert form in edit mode when editingRule is set", () => {
    mockAlertsReturn.editingRule = 1;
    mockAlertsReturn.editingRuleData = { name: "test rule" };
    renderWithClient(<Settings />);
    expect(screen.getByTestId("alert-form")).toBeInTheDocument();
    expect(screen.getByTestId("form-mode")).toHaveTextContent("edit");
  });

  it("calls handleUpdate on submit when in edit mode", async () => {
    const user = userEvent.setup();
    mockAlertsReturn.editingRule = 1;
    mockAlertsReturn.editingRuleData = { name: "test rule" };
    renderWithClient(<Settings />);
    await user.click(screen.getByTestId("form-submit"));
    expect(mockAlertsReturn.handleUpdate).toHaveBeenCalled();
  });

  it("calls handleCreate on submit when in create mode", async () => {
    const user = userEvent.setup();
    renderWithClient(<Settings />);
    await user.click(screen.getByText("Create Alert"));
    await user.click(screen.getByTestId("form-submit"));
    expect(mockAlertsReturn.handleCreate).toHaveBeenCalled();
  });

  it("cancels alert form and resets state", async () => {
    const user = userEvent.setup();
    renderWithClient(<Settings />);
    await user.click(screen.getByText("Create Alert"));
    expect(screen.getByTestId("alert-form")).toBeInTheDocument();
    await user.click(screen.getByTestId("form-cancel"));
    expect(screen.queryByTestId("alert-form")).not.toBeInTheDocument();
    expect(mockAlertsReturn.handleCancelEdit).toHaveBeenCalled();
  });

  it("disables Check Now button when submitting", () => {
    mockAlertsReturn.isSubmitting = true;
    renderWithClient(<Settings />);
    expect(screen.getByText("Check Now")).toBeDisabled();
  });

  it("renders rule list with toggle/edit/delete actions", async () => {
    const user = userEvent.setup();
    mockAlertsReturn.rules = [{ id: 1 }, { id: 2 }];
    renderWithClient(<Settings />);
    await user.click(screen.getByTestId("edit-1"));
    expect(mockAlertsReturn.handleEdit).toHaveBeenCalledWith(1);
    await user.click(screen.getByTestId("delete-2"));
    expect(mockAlertsReturn.openDeleteConfirm).toHaveBeenCalledWith(2);
    await user.click(screen.getByTestId("toggle-1"));
    expect(mockAlertsReturn.handleToggle).toHaveBeenCalledWith(1);
  });

  it("says the alert data failed to load instead of claiming no rules are configured", () => {
    // 「尚未設定警報規則」與「讀不到」是兩件事：讀不到時說尚未設定，使用者會以為規則不見了
    const failed = { ready: false, failed: true, inProgress: false, retry: vi.fn() };
    mockAlertsReturn.rulesLoad = failed;
    mockAlertsReturn.dataLoad = failed;
    renderWithClient(<Settings />);

    expect(screen.getByTestId("alerts-load-error")).toHaveTextContent(
      "Couldn't load your alert settings."
    );
    expect(screen.queryByTestId("alert-list")).not.toBeInTheDocument();
  });

  it("reloads the alert data when retry is pressed on the load error", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    mockAlertsReturn.dataLoad = { ready: false, failed: true, inProgress: false, retry };
    renderWithClient(<Settings />);

    await user.click(
      within(screen.getByTestId("alerts-load-error")).getByRole("button", { name: "Retry" })
    );

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("puts the load error above the alert form, where the empty dropdowns are", async () => {
    // 表單的下拉選單靠的就是這份資料：讀不到時說明要排在表單前面，不是被表單推到下面
    const user = userEvent.setup();
    mockAlertsReturn.dataLoad = { ready: false, failed: true, inProgress: false, retry: vi.fn() };
    renderWithClient(<Settings />);
    await user.click(screen.getByText("Create Alert"));

    const loadError = screen.getByTestId("alerts-load-error");
    const form = screen.getByTestId("alert-form");

    expect(loadError.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it("keeps the rules already loaded on screen when a reload fails", () => {
    mockAlertsReturn.rules = [{ id: 1 }];
    mockAlertsReturn.rulesLoad = { ready: true, failed: true, inProgress: false, retry: vi.fn() };
    mockAlertsReturn.dataLoad = { ready: true, failed: true, inProgress: false, retry: vi.fn() };
    renderWithClient(<Settings />);

    expect(screen.getByTestId("alerts-load-error")).toBeInTheDocument();
    expect(screen.getByTestId("alert-list")).toBeInTheDocument();
  });

  it("does not claim no rules are configured before the rules are loaded", () => {
    // 查詢暫停時 isLoading 是 false，頁面照常畫出來，但規則還沒讀到
    mockAlertsReturn.rulesLoad = { ready: false, failed: false, inProgress: false, retry: vi.fn() };
    renderWithClient(<Settings />);

    expect(screen.queryByTestId("alert-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("alerts-load-error")).not.toBeInTheDocument();
  });

  it("keeps the page and the load error in place while a retry of the alert data runs", () => {
    // 還沒有資料時重試一開始，isLoading 又變回 true：整頁換成「載入中」的話重試鈕跟著消失，
    // 再失敗一次錯誤又掉回頁尾
    mockAlertsReturn.isLoading = true;
    const retrying = { ready: false, failed: true, inProgress: true, retry: vi.fn() };
    mockAlertsReturn.rulesLoad = retrying;
    mockAlertsReturn.dataLoad = retrying;
    renderWithClient(<Settings />);

    expect(screen.getByTestId("github-section")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("alerts-load-error")).getByRole("button", { name: "Retrying…" })
    ).toBeInTheDocument();
    expect(within(screen.getByTestId("alerts-section")).queryByText("Loading...")).toBeNull();
  });

  it("does not claim no rules are configured when reloading an empty rule list fails", () => {
    // 上一次讀到的是空清單，不代表現在還是空的
    mockAlertsReturn.rulesLoad = { ready: true, failed: true, inProgress: false, retry: vi.fn() };
    mockAlertsReturn.dataLoad = { ready: true, failed: true, inProgress: false, retry: vi.fn() };
    renderWithClient(<Settings />);

    expect(screen.getByTestId("alerts-load-error")).toBeInTheDocument();
    expect(screen.queryByTestId("alert-list")).not.toBeInTheDocument();
  });
});
