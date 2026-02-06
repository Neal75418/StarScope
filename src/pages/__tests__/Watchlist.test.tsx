import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Watchlist } from "../Watchlist";
import type { RepoWithSignals } from "../../api/client";

function makeRepo(overrides: Partial<RepoWithSignals> = {}): RepoWithSignals {
  return {
    id: 1,
    owner: "facebook",
    name: "react",
    full_name: "facebook/react",
    url: "https://github.com/facebook/react",
    description: "A JavaScript library",
    language: "JavaScript",
    added_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-06-01T00:00:00Z",
    stars: 200000,
    forks: 40000,
    stars_delta_7d: 500,
    stars_delta_30d: 2000,
    velocity: 71.4,
    acceleration: 5.2,
    trend: 1,
    last_fetched: "2024-06-01T00:00:00Z",
    ...overrides,
  };
}

const mockHandleRetry = vi.fn();
const mockOpenAddDialog = vi.fn();
const mockHandleRefreshAll = vi.fn();

let mockWatchlistReturn: Record<string, unknown>;

vi.mock("../../hooks/useWatchlist", () => ({
  useWatchlist: () => mockWatchlistReturn,
}));

vi.mock("../../hooks/useBatchRepoData", () => ({
  useBatchRepoData: () => ({ dataMap: {} }),
}));

vi.mock("../../hooks/useCategoryOperations", () => ({
  useCategoryOperations: () => ({
    removeFromCategory: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock("../../i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../i18n")>();
  return {
    ...actual,
    useI18n: () => ({
      t: {
        common: { loading: "Loading...", error: "Error", delete: "Delete" },
        watchlist: {
          title: "Watchlist",
          subtitle: "Track your repositories",
          addRepo: "Add Repo",
          refreshAll: "Refresh All",
          refreshing: "Refreshing...",
          recalculateAll: "Recalculate",
          recalculating: "Calculating...",
          searchPlaceholder: "Search repos...",
          showing: "Showing {count} of {total}",
          connection: {
            title: "Connection Error",
            message: "Cannot connect to backend",
            autoRetry: "Auto-retrying...",
            retry: "Retry",
          },
          empty: {
            noRepos: "No repos yet",
            addPrompt: "Add a repo to get started",
            noSearch: "No results found",
            noCategory: "No repos in category",
          },
        },
        dialog: {
          addRepo: {
            title: "Add Repo",
            hint: "Enter repo",
            exampleFormat: "owner/repo",
            exampleUrl: "https://github.com/owner/repo",
            placeholder: "e.g., facebook/react",
            add: "Add",
          },
          removeRepo: {
            title: "Remove Repo",
            message: "Remove {name}?",
            confirm: "Remove",
          },
        },
        categories: { removedFromCategory: "Removed from category" },
        toast: { error: "Error", repoAdded: "Repo added" },
        repo: {
          chart: "Chart",
          hide: "Hide",
          similar: "Similar",
          refresh: "Refresh",
          remove: "Remove",
          removeFromCategory: "Remove from category",
          stars: "Stars",
          velocity: "Velocity",
          trend: "Trend",
        },
      },
    }),
    interpolate: (template: string, vars: Record<string, unknown>) => {
      let result = template;
      for (const [key, val] of Object.entries(vars)) {
        result = result.replace(`{${key}}`, String(val));
      }
      return result;
    },
  };
});

vi.mock("../../components/motion", () => ({
  AnimatedPage: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

vi.mock("../../components/CategorySidebar", () => ({
  CategorySidebar: () => <div data-testid="category-sidebar" />,
}));

vi.mock("../../components/RepoCard", () => ({
  RepoCard: ({ repo }: { repo: RepoWithSignals }) => (
    <div data-testid={`repo-card-${repo.id}`}>{repo.full_name}</div>
  ),
}));

vi.mock("../../components/AddRepoDialog", () => ({
  AddRepoDialog: () => null,
}));

vi.mock("../../components/ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));

vi.mock("../../components/Toast", () => ({
  ToastContainer: () => null,
  useToast: () => ({ toasts: [], dismissToast: vi.fn(), success: vi.fn(), error: vi.fn() }),
}));

vi.mock("../../components/EmptyState", () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}));

describe("Watchlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWatchlistReturn = {
      repos: [],
      displayedRepos: [],
      isLoading: false,
      isRefreshing: false,
      isRecalculatingSimilarities: false,
      loadingRepoId: null,
      error: null,
      isConnected: true,
      isDialogOpen: false,
      dialogError: null,
      isAddingRepo: false,
      selectedCategoryId: null,
      searchQuery: "",
      removeConfirm: { isOpen: false, repoName: "" },
      toast: { toasts: [], dismissToast: vi.fn(), success: vi.fn(), error: vi.fn() },
      handleAddRepo: vi.fn(),
      handleRemoveRepo: vi.fn(),
      confirmRemoveRepo: vi.fn(),
      cancelRemoveRepo: vi.fn(),
      handleFetchRepo: vi.fn(),
      handleRefreshAll: mockHandleRefreshAll,
      handleRecalculateAll: vi.fn(),
      handleRetry: mockHandleRetry,
      openAddDialog: mockOpenAddDialog,
      closeAddDialog: vi.fn(),
      clearError: vi.fn(),
      setSelectedCategoryId: vi.fn(),
      setSearchQuery: vi.fn(),
    };
  });

  it("shows loading state", () => {
    mockWatchlistReturn.isLoading = true;
    render(<Watchlist />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows connection error with retry button", async () => {
    const user = userEvent.setup();
    mockWatchlistReturn.isConnected = false;
    render(<Watchlist />);
    expect(screen.getByText("Connection Error")).toBeInTheDocument();
    await user.click(screen.getByText("Retry"));
    expect(mockHandleRetry).toHaveBeenCalled();
  });

  it("shows empty state when no repos", () => {
    render(<Watchlist />);
    expect(screen.getAllByTestId("empty-state").length).toBeGreaterThan(0);
    expect(screen.getByText("No repos yet")).toBeInTheDocument();
  });

  it("renders repo cards when repos exist", () => {
    const repos = [makeRepo({ id: 1 }), makeRepo({ id: 2, full_name: "vuejs/vue" })];
    mockWatchlistReturn.repos = repos;
    mockWatchlistReturn.displayedRepos = repos;
    render(<Watchlist />);
    expect(screen.getByText("facebook/react")).toBeInTheDocument();
    expect(screen.getByText("vuejs/vue")).toBeInTheDocument();
  });

  it("renders toolbar with add and refresh buttons", () => {
    render(<Watchlist />);
    expect(screen.getByLabelText("Add Repo")).toBeInTheDocument();
    expect(screen.getByLabelText("Refresh All")).toBeInTheDocument();
  });
});
