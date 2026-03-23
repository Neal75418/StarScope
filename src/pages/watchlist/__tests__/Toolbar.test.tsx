import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Toolbar } from "../Toolbar";

describe("Toolbar", () => {
  const defaultProps = {
    onAddRepo: vi.fn(),
    onRefreshAll: vi.fn(),
    onRecalculateAll: vi.fn(),
    isRefreshing: false,
    isRecalculating: false,
    selectedCategoryId: null as number | null,
    displayedCount: 10,
    totalCount: 10,
    searchQuery: "",
    onSearchChange: vi.fn(),
    sortKey: "added_at" as const,
    sortDirection: "desc" as const,
    onSortChange: vi.fn(),
    viewMode: "list" as const,
    onViewModeChange: vi.fn(),
    isSelectionMode: false,
    onEnterSelectionMode: vi.fn(),
    onExitSelectionMode: vi.fn(),
    onSelectAll: vi.fn(),
    selectedCount: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders search input, add, refresh, and recalculate buttons", () => {
    render(<Toolbar {...defaultProps} />);
    expect(screen.getByTestId("watchlist-search")).toBeInTheDocument();
    expect(screen.getByTestId("add-repo-btn")).toBeInTheDocument();
    expect(screen.getByTestId("refresh-all-btn")).toBeInTheDocument();
  });

  it("calls onAddRepo when add button clicked", async () => {
    const user = userEvent.setup();
    render(<Toolbar {...defaultProps} />);
    await user.click(screen.getByTestId("add-repo-btn"));
    expect(defaultProps.onAddRepo).toHaveBeenCalled();
  });

  it("debounces search input by 300ms", async () => {
    const user = userEvent.setup();
    render(<Toolbar {...defaultProps} />);

    const input = screen.getByTestId("watchlist-search");
    await user.type(input, "react");

    // Wait for the debounce
    await vi.waitFor(() => {
      expect(defaultProps.onSearchChange).toHaveBeenCalledWith("react");
    });
  });

  it("disables refresh button when isRefreshing", () => {
    render(<Toolbar {...defaultProps} isRefreshing={true} />);
    expect(screen.getByTestId("refresh-all-btn")).toBeDisabled();
  });

  it("shows filter indicator when category is selected", () => {
    render(<Toolbar {...defaultProps} selectedCategoryId={1} displayedCount={3} totalCount={10} />);
    expect(screen.getByText(/3.*10/)).toBeInTheDocument();
  });

  it("shows filter indicator when search query exists", () => {
    render(<Toolbar {...defaultProps} searchQuery="react" displayedCount={5} totalCount={10} />);
    expect(screen.getByText(/5.*10/)).toBeInTheDocument();
  });

  it("does not show filter indicator when no filter active", () => {
    render(<Toolbar {...defaultProps} />);
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
  });

  it("shows localized aria-label on sort direction indicator", () => {
    render(<Toolbar {...defaultProps} sortKey="stars" sortDirection="desc" />);
    expect(screen.getByLabelText("Descending")).toBeInTheDocument();
  });

  it("shows ascending aria-label when sort direction is asc", () => {
    render(<Toolbar {...defaultProps} sortKey="stars" sortDirection="asc" />);
    expect(screen.getByLabelText("Ascending")).toBeInTheDocument();
  });
});
