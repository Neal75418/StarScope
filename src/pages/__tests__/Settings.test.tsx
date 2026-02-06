import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Settings } from "../Settings";

let mockAlertsReturn: Record<string, unknown>;

vi.mock("../../hooks/useAlertRules", () => ({
  useAlertRules: () => mockAlertsReturn,
}));

vi.mock("../../components/Toast", () => ({
  ToastContainer: () => null,
  useToast: () => ({ toasts: [], dismissToast: vi.fn(), success: vi.fn(), error: vi.fn() }),
}));

vi.mock("../../components/ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));

vi.mock("../../components/GitHubConnection", () => ({
  GitHubConnection: () => <div data-testid="github-connection">GitHub Connection</div>,
}));

vi.mock("../../components/settings", () => ({
  ExportSection: () => <div data-testid="export-section">Export</div>,
  ImportSection: () => <div data-testid="import-section">Import</div>,
  AlertRuleForm: () => <div data-testid="alert-form">Alert Form</div>,
  AlertRuleList: () => <div data-testid="alert-list">Alert List</div>,
}));

vi.mock("../../components/motion", () => ({
  AnimatedPage: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

vi.mock("../../i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../i18n")>();
  return {
    ...actual,
    useI18n: () => ({
      t: {
        common: { loading: "Loading...", delete: "Delete" },
        settings: {
          title: "Settings",
          subtitle: "Manage your preferences",
          loading: "Loading settings...",
          alerts: {
            title: "Alert Rules",
            noAlerts: "No alert rules configured",
            create: "Create Rule",
            checkNow: "Check Now",
            confirm: {
              deleteTitle: "Delete Rule",
              deleteMessage: "Are you sure?",
            },
          },
        },
      },
    }),
  };
});

describe("Settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAlertsReturn = {
      rules: [],
      isLoading: false,
      isSubmitting: false,
      editingRule: null,
      editingRuleData: null,
      initialAlertRule: {},
      signalTypes: [],
      repos: [],
      deleteConfirm: { isOpen: false },
      handleCreate: vi.fn(),
      handleUpdate: vi.fn(),
      handleToggle: vi.fn(),
      handleEdit: vi.fn(),
      handleCancelEdit: vi.fn(),
      handleCheckNow: vi.fn(),
      openDeleteConfirm: vi.fn(),
      confirmDelete: vi.fn(),
      closeDeleteConfirm: vi.fn(),
    };
  });

  it("shows loading state", () => {
    mockAlertsReturn.isLoading = true;
    render(<Settings />);
    expect(screen.getByText("Loading settings...")).toBeInTheDocument();
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
    expect(screen.getByText("Create Rule")).toBeInTheDocument();
  });
});
