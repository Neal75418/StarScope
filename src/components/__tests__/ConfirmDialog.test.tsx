/**
 * Unit tests for ConfirmDialog component
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ConfirmDialog } from "../ConfirmDialog";


describe("ConfirmDialog", () => {
  const mockOnConfirm = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <ConfirmDialog
        isOpen={false}
        title="Test"
        message="Test message"
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders dialog when isOpen is true", () => {
    render(
      <ConfirmDialog
        isOpen={true}
        title="Delete Item"
        message="Are you sure?"
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.getByText("Delete Item")).toBeInTheDocument();
    expect(screen.getByText("Are you sure?")).toBeInTheDocument();
  });

  it("uses default confirm and cancel text from i18n", () => {
    render(
      <ConfirmDialog
        isOpen={true}
        title="Test"
        message="Test"
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.getByText("Confirm")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("uses custom confirm and cancel text when provided", () => {
    render(
      <ConfirmDialog
        isOpen={true}
        title="Test"
        message="Test"
        confirmText="Delete"
        cancelText="Keep"
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.getByText("Delete")).toBeInTheDocument();
    expect(screen.getByText("Keep")).toBeInTheDocument();
  });

  it("calls onConfirm when confirm button clicked", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        isOpen={true}
        title="Test"
        message="Test"
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    await user.click(screen.getByText("Confirm"));

    expect(mockOnConfirm).toHaveBeenCalled();
  });

  it("calls onCancel when cancel button clicked", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        isOpen={true}
        title="Test"
        message="Test"
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    await user.click(screen.getByText("Cancel"));

    expect(mockOnCancel).toHaveBeenCalled();
  });

  it("calls onCancel when overlay clicked", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ConfirmDialog
        isOpen={true}
        title="Test"
        message="Test"
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    const overlay = container.querySelector(".dialog-overlay");
    if (overlay) {
      await user.click(overlay);
    }

    expect(mockOnCancel).toHaveBeenCalled();
  });

  it("applies danger variant class", () => {
    render(
      <ConfirmDialog
        isOpen={true}
        title="Test"
        message="Test"
        variant="danger"
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    const confirmBtn = screen.getByText("Confirm");
    expect(confirmBtn).toHaveClass("btn-danger");
  });

  it("applies warning variant class", () => {
    render(
      <ConfirmDialog
        isOpen={true}
        title="Test"
        message="Test"
        variant="warning"
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    const confirmBtn = screen.getByText("Confirm");
    expect(confirmBtn).toHaveClass("btn-warning");
  });

  it("applies primary variant class by default", () => {
    render(
      <ConfirmDialog
        isOpen={true}
        title="Test"
        message="Test"
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    const confirmBtn = screen.getByText("Confirm");
    expect(confirmBtn).toHaveClass("btn-primary");
  });

  it("has proper ARIA attributes", () => {
    render(
      <ConfirmDialog
        isOpen={true}
        title="Confirm Action"
        message="Are you sure?"
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });
});
