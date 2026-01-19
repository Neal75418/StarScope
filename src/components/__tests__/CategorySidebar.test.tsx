/**
 * Unit tests for CategorySidebar component
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { CategorySidebar } from "../CategorySidebar";
import * as apiClient from "../../api/client";

// Mock API client
vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getCategoryTree: vi.fn(),
    createCategory: vi.fn(),
    deleteCategory: vi.fn(),
  };
});

// Mock i18n
vi.mock("../../i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../i18n")>();
  return {
    ...actual,
    useI18n: () => ({
      t: {
        categories: {
          title: "Categories",
          loading: "Loading...",
          loadError: "Failed to load categories",
          addCategory: "Add Category",
          deleteCategory: "Delete Category",
          deleteConfirm: "Are you sure?",
          namePlaceholder: "Category name",
          add: "Add",
          cancel: "Cancel",
          allRepos: "All Repositories",
          empty: "No categories yet",
        },
      },
    }),
  };
});

// Mock window.confirm
global.confirm = vi.fn(() => true);

describe("CategorySidebar", () => {
  const mockOnSelectCategory = vi.fn();
  const mockOnCategoriesChange = vi.fn();

  const mockCategoryTree = {
    total: 3,
    tree: [
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
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    vi.mocked(apiClient.getCategoryTree).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(<CategorySidebar selectedCategoryId={null} onSelectCategory={mockOnSelectCategory} />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("displays categories after loading", async () => {
    vi.mocked(apiClient.getCategoryTree).mockResolvedValue(mockCategoryTree);

    render(<CategorySidebar selectedCategoryId={null} onSelectCategory={mockOnSelectCategory} />);

    await waitFor(() => {
      expect(screen.getByText("Frontend")).toBeInTheDocument();
      expect(screen.getByText("Backend")).toBeInTheDocument();
    });
  });

  it("shows error message on load failure", async () => {
    vi.mocked(apiClient.getCategoryTree).mockRejectedValue(new Error("Network error"));

    render(<CategorySidebar selectedCategoryId={null} onSelectCategory={mockOnSelectCategory} />);

    await waitFor(() => {
      expect(screen.getByText("Failed to load categories")).toBeInTheDocument();
    });
  });

  it("displays All Repositories option", async () => {
    vi.mocked(apiClient.getCategoryTree).mockResolvedValue(mockCategoryTree);

    render(<CategorySidebar selectedCategoryId={null} onSelectCategory={mockOnSelectCategory} />);

    await waitFor(() => {
      expect(screen.getByText("All Repositories")).toBeInTheDocument();
    });
  });

  it("calls onSelectCategory when category clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.getCategoryTree).mockResolvedValue(mockCategoryTree);

    render(<CategorySidebar selectedCategoryId={null} onSelectCategory={mockOnSelectCategory} />);

    await waitFor(() => {
      expect(screen.getByText("Frontend")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Frontend"));

    expect(mockOnSelectCategory).toHaveBeenCalledWith(1);
  });

  it("highlights selected category", async () => {
    vi.mocked(apiClient.getCategoryTree).mockResolvedValue(mockCategoryTree);

    const { container } = render(
      <CategorySidebar selectedCategoryId={1} onSelectCategory={mockOnSelectCategory} />
    );

    await waitFor(() => {
      const selectedItem = container.querySelector(".category-item.selected");
      expect(selectedItem).toBeInTheDocument();
    });
  });

  it("shows add category form when add button clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.getCategoryTree).mockResolvedValue({ total: 0, tree: [] });

    render(<CategorySidebar selectedCategoryId={null} onSelectCategory={mockOnSelectCategory} />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    await user.click(screen.getByTitle("Add Category"));

    expect(screen.getByPlaceholderText("Category name")).toBeInTheDocument();
  });

  it("creates new category", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.getCategoryTree).mockResolvedValue({ total: 0, tree: [] });
    vi.mocked(apiClient.createCategory).mockResolvedValue({
      id: 1,
      name: "New Category",
      description: null,
      icon: null,
      color: null,
      parent_id: null,
      sort_order: 0,
      created_at: "2026-01-19",
      repo_count: 0,
    });

    render(
      <CategorySidebar
        selectedCategoryId={null}
        onSelectCategory={mockOnSelectCategory}
        onCategoriesChange={mockOnCategoriesChange}
      />
    );

    await waitFor(() => screen.getByTitle("Add Category"));

    await user.click(screen.getByTitle("Add Category"));

    const input = screen.getByPlaceholderText("Category name");
    await user.type(input, "New Category");
    await user.click(screen.getByText("Add"));

    await waitFor(() => {
      expect(apiClient.createCategory).toHaveBeenCalledWith({ name: "New Category" });
      expect(mockOnCategoriesChange).toHaveBeenCalled();
    });
  });

  it("shows repo count for each category", async () => {
    vi.mocked(apiClient.getCategoryTree).mockResolvedValue(mockCategoryTree);

    render(<CategorySidebar selectedCategoryId={null} onSelectCategory={mockOnSelectCategory} />);

    await waitFor(() => {
      const counts = screen.getAllByText(/[0-9]+/);
      expect(counts.length).toBeGreaterThan(0);
    });
  });

  it("expands and collapses categories with children", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.getCategoryTree).mockResolvedValue(mockCategoryTree);

    render(<CategorySidebar selectedCategoryId={null} onSelectCategory={mockOnSelectCategory} />);

    await waitFor(() => screen.getByText("Frontend"));

    // React should not be visible initially
    expect(screen.queryByText("React")).not.toBeInTheDocument();

    // Click expand button
    const expandButton = screen.getByText("▶");
    await user.click(expandButton);

    // Now React should be visible
    await waitFor(() => {
      expect(screen.getByText("React")).toBeInTheDocument();
    });
  });
});
