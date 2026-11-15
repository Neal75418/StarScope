/**
 * Unit tests for CategorySidebar component
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { CategorySidebar, CategoryTreeData } from "../CategorySidebar";
import type { CategoryTreeNode } from "../../api/client";
import * as apiClient from "../../api/client";

// Mock API client (getCategory is still called internally for edit)
// 分類操作失敗的 toast 走 WatchlistContext；這裡沒有 provider
const mockShowToast = vi.fn();
vi.mock("../../contexts/WatchlistContext", () => ({
  useWatchlistActions: () => ({ showToast: mockShowToast }),
}));

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getCategory: vi.fn(),
  };
});

const mockTree: CategoryTreeNode[] = [
  {
    id: 1,
    name: "Frontend",
    description: null,
    icon: "🎨",
    color: "#3b82f6",
    sort_order: 0,
    repo_count: 5,
    children: [
      {
        id: 2,
        name: "React",
        description: null,
        icon: "⚛️",
        color: null,
        sort_order: 0,
        repo_count: 3,
        children: [],
      },
    ],
  },
  {
    id: 3,
    name: "Backend",
    description: null,
    icon: "⚙️",
    color: "#10b981",
    sort_order: 1,
    repo_count: 2,
    children: [],
  },
];

function makeCategoryTreeData(overrides: Partial<CategoryTreeData> = {}): CategoryTreeData {
  return {
    tree: mockTree,
    loading: false,
    error: null,
    fetchCategories: vi.fn().mockResolvedValue(undefined),
    handleCreateCategory: vi.fn().mockResolvedValue(true),
    handleUpdateCategory: vi.fn().mockResolvedValue(true),
    handleDeleteCategory: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("CategorySidebar", () => {
  const mockOnSelectCategory = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    render(
      <CategorySidebar
        selectedCategoryId={null}
        onSelectCategory={mockOnSelectCategory}
        categoryTree={makeCategoryTreeData({ loading: true, tree: [] })}
      />
    );

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("displays categories after loading", () => {
    render(
      <CategorySidebar
        selectedCategoryId={null}
        onSelectCategory={mockOnSelectCategory}
        categoryTree={makeCategoryTreeData()}
      />
    );

    expect(screen.getByText("Frontend")).toBeInTheDocument();
    expect(screen.getByText("Backend")).toBeInTheDocument();
  });

  it("shows error message on load failure", () => {
    render(
      <CategorySidebar
        selectedCategoryId={null}
        onSelectCategory={mockOnSelectCategory}
        categoryTree={makeCategoryTreeData({ error: "Failed to load categories", tree: [] })}
      />
    );

    expect(screen.getByText("Failed to load categories")).toBeInTheDocument();
  });

  it("displays All Repositories option", () => {
    render(
      <CategorySidebar
        selectedCategoryId={null}
        onSelectCategory={mockOnSelectCategory}
        categoryTree={makeCategoryTreeData()}
      />
    );

    expect(screen.getByText("All Repositories")).toBeInTheDocument();
  });

  it("calls onSelectCategory when category clicked", async () => {
    const user = userEvent.setup();

    render(
      <CategorySidebar
        selectedCategoryId={null}
        onSelectCategory={mockOnSelectCategory}
        categoryTree={makeCategoryTreeData()}
      />
    );

    await user.click(screen.getByText("Frontend"));

    expect(mockOnSelectCategory).toHaveBeenCalledWith(1);
  });

  it("highlights selected category", () => {
    const { container } = render(
      <CategorySidebar
        selectedCategoryId={1}
        onSelectCategory={mockOnSelectCategory}
        categoryTree={makeCategoryTreeData()}
      />
    );

    const selectedItem = container.querySelector(".category-item.selected");
    expect(selectedItem).toBeInTheDocument();
  });

  it("shows add category form when add button clicked", async () => {
    const user = userEvent.setup();

    render(
      <CategorySidebar
        selectedCategoryId={null}
        onSelectCategory={mockOnSelectCategory}
        categoryTree={makeCategoryTreeData({ tree: [] })}
      />
    );

    await user.click(screen.getByTitle("Add category"));

    expect(screen.getByPlaceholderText("Category name")).toBeInTheDocument();
  });

  it("creates new category", async () => {
    const user = userEvent.setup();
    const mockCreate = vi.fn().mockResolvedValue(true);

    render(
      <CategorySidebar
        selectedCategoryId={null}
        onSelectCategory={mockOnSelectCategory}
        categoryTree={makeCategoryTreeData({ tree: [], handleCreateCategory: mockCreate })}
      />
    );

    await user.click(screen.getByTitle("Add category"));

    const input = screen.getByPlaceholderText("Category name");
    await user.type(input, "New Category");
    await user.click(screen.getByText("Add"));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith("New Category");
    });
  });

  it("shows repo count for each category", () => {
    render(
      <CategorySidebar
        selectedCategoryId={null}
        onSelectCategory={mockOnSelectCategory}
        categoryTree={makeCategoryTreeData()}
      />
    );

    // Frontend: 5, Backend: 2
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("expands and collapses categories with children", async () => {
    const user = userEvent.setup();

    render(
      <CategorySidebar
        selectedCategoryId={null}
        onSelectCategory={mockOnSelectCategory}
        categoryTree={makeCategoryTreeData()}
      />
    );

    // React should not be visible initially
    expect(screen.queryByText("React")).not.toBeInTheDocument();

    const expandButton = screen.getByLabelText("Expand");
    await user.click(expandButton);

    await waitFor(() => {
      expect(screen.getByText("React")).toBeInTheDocument();
    });
  });

  it("deletes a category after confirmation", async () => {
    const user = userEvent.setup();
    const mockDelete = vi.fn().mockResolvedValue(true);

    render(
      <CategorySidebar
        selectedCategoryId={null}
        onSelectCategory={mockOnSelectCategory}
        categoryTree={makeCategoryTreeData({ handleDeleteCategory: mockDelete })}
      />
    );

    const deleteButtons = screen.getAllByTitle("Delete category");
    await user.click(deleteButtons[deleteButtons.length - 1]);

    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete category" }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith(3);
    });
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("names the category and what happens to its repositories before deleting", async () => {
    const user = userEvent.setup();
    render(
      <CategorySidebar
        selectedCategoryId={null}
        onSelectCategory={mockOnSelectCategory}
        categoryTree={makeCategoryTreeData()}
      />
    );

    const deleteButtons = screen.getAllByTitle("Delete category");
    await user.click(deleteButtons[deleteButtons.length - 1]);

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(
      "Delete \"Backend\"? Repositories in it stay on your watchlist — they just won't belong to this category. This can't be undone."
    );
    // 按鈕寫的是動作本身，不是「確認」
    expect(within(dialog).queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
  });

  it("names a nested category by its own name", async () => {
    const user = userEvent.setup();
    render(
      <CategorySidebar
        selectedCategoryId={null}
        onSelectCategory={mockOnSelectCategory}
        categoryTree={makeCategoryTreeData()}
      />
    );
    // 展開 Frontend 才看得到底下的 React
    await user.click(screen.getByRole("button", { name: /expand/i }));

    const reactRow = screen.getByText("React").closest<HTMLElement>(".category-item");
    expect(reactRow).not.toBeNull();
    await user.click(within(reactRow as HTMLElement).getByTitle("Delete category"));

    expect(await screen.findByRole("alertdialog")).toHaveTextContent('Delete "React"?');
  });

  it("selects All Repositories when clicked", async () => {
    const user = userEvent.setup();

    render(
      <CategorySidebar
        selectedCategoryId={1}
        onSelectCategory={mockOnSelectCategory}
        categoryTree={makeCategoryTreeData()}
      />
    );

    await user.click(screen.getByText("All Repositories"));

    expect(mockOnSelectCategory).toHaveBeenCalledWith(null);
  });

  it("shows category icons", () => {
    render(
      <CategorySidebar
        selectedCategoryId={null}
        onSelectCategory={mockOnSelectCategory}
        categoryTree={makeCategoryTreeData()}
      />
    );

    expect(screen.getByText("🎨")).toBeInTheDocument();
    expect(screen.getByText("⚙️")).toBeInTheDocument();
  });

  it("keeps delete dialog open when deletion fails", async () => {
    const user = userEvent.setup();
    const mockDelete = vi.fn().mockResolvedValue(false);

    render(
      <CategorySidebar
        selectedCategoryId={null}
        onSelectCategory={mockOnSelectCategory}
        categoryTree={makeCategoryTreeData({ handleDeleteCategory: mockDelete })}
      />
    );

    const deleteButtons = screen.getAllByTitle("Delete category");
    await user.click(deleteButtons[deleteButtons.length - 1]);

    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete category" }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith(3);
    });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("says the category was not deleted when deletion fails", async () => {
    // 對話框留著讓人重試，但要說出這一下沒有成功：否則按鈕只是從停用變回可按
    const user = userEvent.setup();
    render(
      <CategorySidebar
        selectedCategoryId={null}
        onSelectCategory={mockOnSelectCategory}
        categoryTree={makeCategoryTreeData({
          handleDeleteCategory: vi.fn().mockResolvedValue(false),
        })}
      />
    );

    const deleteButtons = screen.getAllByTitle("Delete category");
    await user.click(deleteButtons[deleteButtons.length - 1]);
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete category" }));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith("error", '"Backend" was not deleted. Try again.')
    );
  });

  it("says the changes were not saved when updating a category fails", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.getCategory).mockRejectedValueOnce(new Error("use the cached node"));
    render(
      <CategorySidebar
        selectedCategoryId={null}
        onSelectCategory={mockOnSelectCategory}
        categoryTree={makeCategoryTreeData({
          handleUpdateCategory: vi.fn().mockResolvedValue(false),
        })}
      />
    );

    const editButtons = screen.getAllByTitle("Edit category");
    await user.click(editButtons[editButtons.length - 1]);
    const dialog = await screen.findByRole("dialog");
    const nameInput = within(dialog).getByDisplayValue("Backend");
    await user.clear(nameInput);
    await user.type(nameInput, "Servers");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    // 改名沒有成功，所以提示用的是它現在的名字，不是剛打進去的新名字
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        "error",
        'Changes to "Backend" were not saved. Try again.'
      )
    );
    // 對話框留著，打好的內容還在
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("stays quiet when updating a category succeeds", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.getCategory).mockRejectedValueOnce(new Error("use the cached node"));
    render(
      <CategorySidebar
        selectedCategoryId={null}
        onSelectCategory={mockOnSelectCategory}
        categoryTree={makeCategoryTreeData()}
      />
    );

    const editButtons = screen.getAllByTitle("Edit category");
    await user.click(editButtons[editButtons.length - 1]);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("discards stale edit response when another edit is clicked", async () => {
    const user = userEvent.setup();

    let resolveFirst: (value: unknown) => void = () => undefined;
    const firstCall = new Promise((resolve) => {
      resolveFirst = resolve;
    });

    vi.mocked(apiClient.getCategory)
      .mockImplementationOnce(() => firstCall as Promise<apiClient.Category>)
      .mockResolvedValueOnce({
        id: 3,
        name: "Backend-fresh",
        description: null,
        icon: "⚙️",
        color: "#10b981",
        parent_id: null,
        sort_order: 1,
        created_at: "2024-01-01",
        repo_count: 2,
      });

    render(
      <CategorySidebar
        selectedCategoryId={null}
        onSelectCategory={mockOnSelectCategory}
        categoryTree={makeCategoryTreeData()}
      />
    );

    // Click edit on Frontend (id=1), then immediately on Backend (id=3)
    const editButtons = screen.getAllByTitle("Edit category");
    await user.click(editButtons[0]); // Frontend - slow
    await user.click(editButtons[editButtons.length - 1]); // Backend - fast

    // Backend's fast response should populate the edit modal's name input
    const nameInput = await waitFor(() => {
      const input = screen.getByLabelText(/Name|名稱/) as HTMLInputElement;
      expect(input.value).toBe("Backend-fresh");
      return input;
    });

    // Now resolve the slow Frontend request - it should be discarded.
    // 用 act 包住並 flush microtask：舊寫法的 waitFor 會在 stale promise 的
    // .then 落地「之前」同步先跑一次斷言就通過——stale-guard 拔掉也綠。
    await act(async () => {
      resolveFirst({
        id: 1,
        name: "Frontend-stale",
        description: null,
        icon: "🎨",
        color: "#3b82f6",
        parent_id: null,
        sort_order: 0,
        created_at: "2024-01-01",
        repo_count: 5,
      });
      await Promise.resolve(); // flush stale promise 的 .then 鏈
    });

    // stale 回應已完整落地後，斷言它沒有覆寫
    expect(nameInput.value).toBe("Backend-fresh");
  });
});
