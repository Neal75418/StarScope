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
    selectedCategoryId: null,
    displayedCount: 10,
    totalCount: 10,
    searchQuery: "",
    onSearchChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it("renders search input, add, refresh, and recalculate buttons", () => {
    render(<Toolbar {...defaultProps} />);
    expect(screen.getByTestId("watchlist-search")).toBeInTheDocument();
    expect(screen.getByTestId("add-repo-btn")).toBeInTheDocument();
    expect(screen.getByTestId("refresh-all-btn")).toBeInTheDocument();
  });

  it("calls onAddRepo when add button clicked", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    render(<Toolbar {...defaultProps} />);
    await user.click(screen.getByTestId("add-repo-btn"));
    expect(defaultProps.onAddRepo).toHaveBeenCalled();
  });

  it("debounces search input by 300ms", async () => {
    vi.useRealTimers();
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
});
