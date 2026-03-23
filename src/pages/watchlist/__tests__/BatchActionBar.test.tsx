import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { BatchActionBar } from "../BatchActionBar";

describe("BatchActionBar", () => {
  const mockCategoryTree = [
    {
      id: 1,
      name: "Frontend",
      description: null,
      icon: null,
      color: null,
      sort_order: 0,
      repo_count: 0,
      children: [],
    },
    {
      id: 2,
      name: "Backend",
      description: null,
      icon: null,
      color: null,
      sort_order: 1,
      repo_count: 0,
      children: [
        {
          id: 3,
          name: "API",
          description: null,
          icon: null,
          color: null,
          sort_order: 0,
          repo_count: 0,
          children: [],
        },
      ],
    },
  ];

  const defaultProps = {
    selectedCount: 3,
    isProcessing: false,
    onBatchAddToCategory: vi
      .fn()
      .mockResolvedValue({ success: 3, failed: 0, total: 3, failedIds: [] }),
    onBatchRefresh: vi.fn().mockResolvedValue({ success: 3, failed: 0, total: 3 }),
    onBatchRemove: vi.fn().mockResolvedValue({ success: 3, failed: 0, total: 3, failedIds: [] }),
    onPruneSelection: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
    categoryTree: mockCategoryTree,
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

  it("calls onBatchRemove and onDone when remove clicked and confirmed", async () => {
    const user = userEvent.setup();
    render(<BatchActionBar {...defaultProps} />);

    await user.click(screen.getByTestId("batch-remove"));
    // ConfirmDialog 應出現
    const confirmBtn = screen.getByRole("button", { name: "Confirm" });
    expect(confirmBtn).toBeInTheDocument();
    await user.click(confirmBtn);
    expect(defaultProps.onBatchRemove).toHaveBeenCalled();
  });

  it("does not call onBatchRemove when remove cancelled", async () => {
    const user = userEvent.setup();
    render(<BatchActionBar {...defaultProps} />);

    await user.click(screen.getByTestId("batch-remove"));
    // ConfirmDialog 應出現，點取消
    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    await user.click(cancelBtn);
    expect(defaultProps.onBatchRemove).not.toHaveBeenCalled();
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

  it("calls onDone on full success (refresh)", async () => {
    const user = userEvent.setup();
    render(<BatchActionBar {...defaultProps} />);

    await user.click(screen.getByTestId("batch-refresh"));
    expect(defaultProps.onDone).toHaveBeenCalled();
    expect(defaultProps.onError).not.toHaveBeenCalled();
  });

  it("calls onError on partial failure (refresh)", async () => {
    const user = userEvent.setup();
    const props = {
      ...defaultProps,
      onBatchRefresh: vi.fn().mockResolvedValue({ success: 1, failed: 2, total: 3 }),
    };
    render(<BatchActionBar {...props} />);

    await user.click(screen.getByTestId("batch-refresh"));
    expect(props.onDone).not.toHaveBeenCalled();
    expect(props.onError).toHaveBeenCalledWith(expect.stringContaining("1"));
  });

  it("prunes selection to failed IDs on partial remove", async () => {
    const user = userEvent.setup();
    const props = {
      ...defaultProps,
      onBatchRemove: vi.fn().mockResolvedValue({ success: 2, failed: 1, total: 3, failedIds: [3] }),
    };
    render(<BatchActionBar {...props} />);

    await user.click(screen.getByTestId("batch-remove"));
    const confirmBtn = screen.getByRole("button", { name: "Confirm" });
    await user.click(confirmBtn);

    expect(props.onPruneSelection).toHaveBeenCalledWith([3]);
    expect(props.onDone).not.toHaveBeenCalled();
    expect(props.onError).toHaveBeenCalled();
  });

  it("keeps confirm dialog open while remove is in-flight", async () => {
    const user = userEvent.setup();
    const props = {
      ...defaultProps,
      onBatchRemove: vi.fn().mockReturnValue(new Promise(() => {})), // never resolves
    };
    render(<BatchActionBar {...props} />);

    await user.click(screen.getByTestId("batch-remove"));
    const confirmBtn = screen.getByRole("button", { name: "Confirm" });
    await user.click(confirmBtn);

    // Dialog should still be visible (not dismissed prematurely)
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("prunes selection to failed IDs on partial add-to-category", async () => {
    const user = userEvent.setup();
    const props = {
      ...defaultProps,
      onBatchAddToCategory: vi
        .fn()
        .mockResolvedValue({ success: 2, failed: 1, total: 3, failedIds: [3] }),
    };
    render(<BatchActionBar {...props} />);

    await user.click(screen.getByTestId("batch-add-to-category"));
    await user.click(screen.getByText("Frontend"));

    expect(props.onPruneSelection).toHaveBeenCalledWith([3]);
    expect(props.onDone).not.toHaveBeenCalled();
    expect(props.onError).toHaveBeenCalled();
  });

  it("calls onError on full failure (remove)", async () => {
    const user = userEvent.setup();
    const props = {
      ...defaultProps,
      onBatchRemove: vi
        .fn()
        .mockResolvedValue({ success: 0, failed: 3, total: 3, failedIds: [1, 2, 3] }),
    };
    render(<BatchActionBar {...props} />);

    await user.click(screen.getByTestId("batch-remove"));
    const confirmBtn = screen.getByRole("button", { name: "Confirm" });
    await user.click(confirmBtn);
    expect(props.onDone).not.toHaveBeenCalled();
    expect(props.onError).toHaveBeenCalled();
  });
});
