import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Settings } from "../Settings";

let mockAlertsReturn: Record<string, unknown>;

// noinspection JSUnusedGlobalSymbols
vi.mock("../../hooks/useAlertRules", () => ({
  useAlertRules: () => mockAlertsReturn,
}));

vi.mock("../../components/Toast", () => ({
  ToastContainer: () => null,
  useToast: () => ({ toasts: [], dismissToast: vi.fn(), success: vi.fn(), error: vi.fn() }),
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

// noinspection JSUnusedGlobalSymbols
vi.mock("../../components/GitHubConnection", () => ({
  GitHubConnection: () => <div data-testid="github-connection">GitHub Connection</div>,
}));

// noinspection JSUnusedGlobalSymbols
vi.mock("../../components/settings", () => ({
  ExportSection: () => <div data-testid="export-section">Export</div>,
  ImportSection: () => <div data-testid="import-section">Import</div>,
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

  it("shows loading state", () => {
    mockAlertsReturn.isLoading = true;
    render(<Settings />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("renders all sections when loaded", () => {
    render(<Settings />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByTestId("github-section")).toBeInTheDocument();
    expect(screen.getByTestId("export-section")).toBeInTheDocument();
    expect(screen.getByTestId("import-section")).toBeInTheDocument();
    expect(screen.getByTestId("alerts-section")).toBeInTheDocument();
  });

  it("renders alert rules section with create button", () => {
    render(<Settings />);
    expect(screen.getByText("Alert Rules")).toBeInTheDocument();
    expect(screen.getByText("Create Alert")).toBeInTheDocument();
  });

  it("shows 'no alerts' message when rules list is empty", () => {
    render(<Settings />);
    expect(screen.getByText("No alert rules configured.")).toBeInTheDocument();
  });

  it("does not show 'no alerts' message when rules exist", () => {
    mockAlertsReturn.rules = [{ id: 1 }];
    render(<Settings />);
    expect(screen.queryByText("No alert rules configured.")).not.toBeInTheDocument();
  });

  it("shows Check Now button when form is not visible", () => {
    render(<Settings />);
    expect(screen.getByText("Check Now")).toBeInTheDocument();
  });

  it("calls handleCheckNow when Check Now is clicked", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await user.click(screen.getByText("Check Now"));
    expect(mockAlertsReturn.handleCheckNow).toHaveBeenCalled();
  });

  it("shows alert form in create mode when Create Rule is clicked", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await user.click(screen.getByText("Create Alert"));
    expect(screen.getByTestId("alert-form")).toBeInTheDocument();
    expect(screen.getByTestId("form-mode")).toHaveTextContent("create");
  });

  it("hides Create Rule and Check Now buttons when form is visible", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await user.click(screen.getByText("Create Alert"));
    expect(screen.queryByText("Create Alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Check Now")).not.toBeInTheDocument();
  });

  it("shows alert form in edit mode when editingRule is set", () => {
    mockAlertsReturn.editingRule = 1;
    mockAlertsReturn.editingRuleData = { name: "test rule" };
    render(<Settings />);
    expect(screen.getByTestId("alert-form")).toBeInTheDocument();
    expect(screen.getByTestId("form-mode")).toHaveTextContent("edit");
  });

  it("calls handleUpdate on submit when in edit mode", async () => {
    const user = userEvent.setup();
    mockAlertsReturn.editingRule = 1;
    mockAlertsReturn.editingRuleData = { name: "test rule" };
    render(<Settings />);
    await user.click(screen.getByTestId("form-submit"));
    expect(mockAlertsReturn.handleUpdate).toHaveBeenCalled();
  });

  it("calls handleCreate on submit when in create mode", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await user.click(screen.getByText("Create Alert"));
    await user.click(screen.getByTestId("form-submit"));
    expect(mockAlertsReturn.handleCreate).toHaveBeenCalled();
  });

  it("cancels alert form and resets state", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await user.click(screen.getByText("Create Alert"));
    expect(screen.getByTestId("alert-form")).toBeInTheDocument();
    await user.click(screen.getByTestId("form-cancel"));
    expect(screen.queryByTestId("alert-form")).not.toBeInTheDocument();
    expect(mockAlertsReturn.handleCancelEdit).toHaveBeenCalled();
  });

  it("disables Check Now button when submitting", () => {
    mockAlertsReturn.isSubmitting = true;
    render(<Settings />);
    expect(screen.getByText("Check Now")).toBeDisabled();
  });

  it("renders rule list with toggle/edit/delete actions", async () => {
    const user = userEvent.setup();
    mockAlertsReturn.rules = [{ id: 1 }, { id: 2 }];
    render(<Settings />);
    await user.click(screen.getByTestId("edit-1"));
    expect(mockAlertsReturn.handleEdit).toHaveBeenCalledWith(1);
    await user.click(screen.getByTestId("delete-2"));
    expect(mockAlertsReturn.openDeleteConfirm).toHaveBeenCalledWith(2);
    await user.click(screen.getByTestId("toggle-1"));
    expect(mockAlertsReturn.handleToggle).toHaveBeenCalledWith(1);
  });
});
