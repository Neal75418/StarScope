/**
 * Unit tests for CategoryEditModal component
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { CategoryEditModal } from "../CategoryEditModal";
import type { CategoryTreeNode } from "../../../api/client";


describe("CategoryEditModal", () => {
  const mockCategory: CategoryTreeNode = {
    id: 1,
    name: "Test Category",
    description: "Test description",
    icon: "📁",
    color: "#ff0000",
    sort_order: 0,
    repo_count: 5,
    children: [],
  };

  const defaultProps = {
    category: mockCategory,
    isSubmitting: false,
    onSubmit: vi.fn().mockResolvedValue(true),
    onClose: vi.fn(),
  };

  it("renders with category data", () => {
    render(<CategoryEditModal {...defaultProps} />);

    expect(screen.getByText("Edit category")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Test Category")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Test description")).toBeInTheDocument();
    expect(screen.getByDisplayValue("📁")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CategoryEditModal {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByText("×"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when cancel button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CategoryEditModal {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when overlay is clicked", async () => {
    const onClose = vi.fn();
    const { container } = render(<CategoryEditModal {...defaultProps} onClose={onClose} />);

    const overlay = container.querySelector(".modal-overlay");
    if (overlay) {
      fireEvent.click(overlay);
    }
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close when modal content is clicked", async () => {
    const onClose = vi.fn();
    const { container } = render(<CategoryEditModal {...defaultProps} onClose={onClose} />);

    const modal = container.querySelector(".modal");
    if (modal) {
      fireEvent.click(modal);
    }
    expect(onClose).not.toHaveBeenCalled();
  });

  it("submits form with updated data", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    render(<CategoryEditModal {...defaultProps} onSubmit={onSubmit} onClose={onClose} />);

    const nameInput = screen.getByDisplayValue("Test Category");
    await user.clear(nameInput);
    await user.type(nameInput, "Updated Name");

    await user.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          name: "Updated Name",
        })
      );
    });
  });

  it("calls onClose after successful submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    render(<CategoryEditModal {...defaultProps} onSubmit={onSubmit} onClose={onClose} />);

    await user.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("does not close after failed submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(false);
    const onClose = vi.fn();
    render(<CategoryEditModal {...defaultProps} onSubmit={onSubmit} onClose={onClose} />);

    await user.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows submitting state", () => {
    render(<CategoryEditModal {...defaultProps} isSubmitting={true} />);

    expect(screen.getByText("Saving...")).toBeInTheDocument();
    expect(screen.getByText("Saving...")).toBeDisabled();
  });

  it("handles empty description gracefully", async () => {
    const user = userEvent.setup();
    const categoryWithoutDesc: CategoryTreeNode = {
      ...mockCategory,
      description: null,
      icon: null,
      color: null,
    };
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(
      <CategoryEditModal {...defaultProps} category={categoryWithoutDesc} onSubmit={onSubmit} />
    );

    await user.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          name: "Test Category",
        })
      );
    });
  });
});
