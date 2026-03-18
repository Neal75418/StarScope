import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { BatchActionBar } from "../BatchActionBar";

vi.mock("../../../hooks/useCategoryTree", () => ({
  useCategoryTree: () => ({
    tree: [
      { id: 1, name: "Frontend", children: [] },
      { id: 2, name: "Backend", children: [{ id: 3, name: "API", children: [] }] },
    ],
    loading: false,
    error: null,
    fetchCategories: vi.fn(),
    handleCreateCategory: vi.fn(),
    handleUpdateCategory: vi.fn(),
    handleDeleteCategory: vi.fn(),
  }),
}));

describe("BatchActionBar", () => {
  const defaultProps = {
    selectedCount: 3,
    isProcessing: false,
    onBatchAddToCategory: vi.fn().mockResolvedValue(undefined),
    onBatchRefresh: vi.fn().mockResolvedValue(undefined),
    onBatchRemove: vi.fn().mockResolvedValue(undefined),
    onDone: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders when selectedCount > 0", () => {
    render(<BatchActionBar {...defaultProps} />);
    expect(screen.getByTestId("batch-action-bar")).toBeInTheDocument();
    expect(screen.getByText(/3 selected/)).toBeInTheDocument();
  });

  it("does not render when selectedCount is 0", () => {
    render(<BatchActionBar {...defaultProps} selectedCount={0} />);
    expect(screen.queryByTestId("batch-action-bar")).not.toBeInTheDocument();
  });

  it("calls onBatchRefresh and onDone when refresh clicked", async () => {
    const user = userEvent.setup();
    render(<BatchActionBar {...defaultProps} />);

    await user.click(screen.getByTestId("batch-refresh"));
    expect(defaultProps.onBatchRefresh).toHaveBeenCalled();
  });

  it("calls onBatchRemove and onDone when remove clicked", async () => {
    const user = userEvent.setup();
    render(<BatchActionBar {...defaultProps} />);

    await user.click(screen.getByTestId("batch-remove"));
    expect(defaultProps.onBatchRemove).toHaveBeenCalled();
  });

  it("shows category picker when add-to-category clicked", async () => {
    const user = userEvent.setup();
    render(<BatchActionBar {...defaultProps} />);

    await user.click(screen.getByTestId("batch-add-to-category"));
    expect(screen.getByTestId("batch-category-picker")).toBeInTheDocument();
    expect(screen.getByText("Frontend")).toBeInTheDocument();
    expect(screen.getByText("Backend")).toBeInTheDocument();
    expect(screen.getByText("API")).toBeInTheDocument();
  });

  it("calls onBatchAddToCategory with category id when category selected", async () => {
    const user = userEvent.setup();
    render(<BatchActionBar {...defaultProps} />);

    await user.click(screen.getByTestId("batch-add-to-category"));
    await user.click(screen.getByText("Frontend"));
    expect(defaultProps.onBatchAddToCategory).toHaveBeenCalledWith(1);
  });

  it("disables buttons when processing", () => {
    render(<BatchActionBar {...defaultProps} isProcessing={true} />);
    expect(screen.getByTestId("batch-refresh")).toBeDisabled();
    expect(screen.getByTestId("batch-remove")).toBeDisabled();
  });
});
