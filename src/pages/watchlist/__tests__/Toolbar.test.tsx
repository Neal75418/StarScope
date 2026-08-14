import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
    // fake timers 才守得住 debounce：打完字不得立即呼叫、299ms 仍不得呼叫、
    // 滿 300ms 才以最終值呼叫一次。舊版只 waitFor(被呼叫)，拔掉 debounce 也綠。
    vi.useFakeTimers();
    try {
      render(<Toolbar {...defaultProps} />);

      const input = screen.getByTestId("watchlist-search");
      // fireEvent.change 是同步事件，避免 userEvent 與 fake timers 的互鎖
      fireEvent.change(input, { target: { value: "re" } });
      fireEvent.change(input, { target: { value: "react" } });
      expect(defaultProps.onSearchChange).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(299);
      expect(defaultProps.onSearchChange).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(defaultProps.onSearchChange).toHaveBeenCalledTimes(1);
      expect(defaultProps.onSearchChange).toHaveBeenCalledWith("react");
    } finally {
      vi.useRealTimers();
    }
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
