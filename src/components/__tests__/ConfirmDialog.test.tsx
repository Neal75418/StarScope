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
    const { baseElement } = render(
      <ConfirmDialog
        isOpen={false}
        title="Test"
        message="Test message"
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    expect(baseElement.querySelector(".dialog-overlay")).toBeNull();
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
    const { baseElement } = render(
      <ConfirmDialog
        isOpen={true}
        title="Test"
        message="Test"
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    const overlay = baseElement.querySelector(".dialog-overlay") as HTMLElement;
    expect(overlay).not.toBeNull();
    await user.click(overlay);

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

  it("disables both buttons when isProcessing is true", () => {
    render(
      <ConfirmDialog
        isOpen={true}
        title="Test"
        message="Test"
        isProcessing={true}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.getByText("Confirm")).toBeDisabled();
    expect(screen.getByText("Cancel")).toBeDisabled();
  });

  it("does not call onCancel on ESC key when isProcessing", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        isOpen={true}
        title="Test"
        message="Test"
        isProcessing={true}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    await user.keyboard("{Escape}");

    expect(mockOnCancel).not.toHaveBeenCalled();
  });

  it("does not call onCancel on overlay click when isProcessing", async () => {
    const user = userEvent.setup();
    const { baseElement } = render(
      <ConfirmDialog
        isOpen={true}
        title="Test"
        message="Test"
        isProcessing={true}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    const overlay = baseElement.querySelector(".dialog-overlay") as HTMLElement;
    expect(overlay).not.toBeNull();
    await user.click(overlay);

    expect(mockOnCancel).not.toHaveBeenCalled();
  });

  it("calls onCancel on ESC key while focus is inside the dialog", async () => {
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
    // 對話框一打開焦點就在框內的第一個按鈕上，Esc 由它送出
    expect(screen.getByText("Cancel")).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(mockOnCancel).toHaveBeenCalledTimes(1);
  });

  it("keeps Tab inside the dialog when focus is on the last button", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>Behind the dialog</button>
        <ConfirmDialog
          isOpen={true}
          title="Test"
          message="Test"
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      </>
    );
    screen.getByText("Confirm").focus();

    await user.tab();

    expect(screen.getByText("Cancel")).toHaveFocus();
  });

  it("brings Shift+Tab back into the dialog after the user clicks its text", async () => {
    // 點框內不可聚焦的文字，焦點會落到外層的遮罩（tabIndex -1）；往回 Tab 要回到框內，不是框後面的頁面
    const user = userEvent.setup();
    render(
      <>
        <button>Behind the dialog</button>
        <ConfirmDialog
          isOpen={true}
          title="Test"
          message="Are you sure?"
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      </>
    );
    await user.click(screen.getByText("Are you sure?"));
    expect(screen.getByRole("alertdialog")).not.toContainElement(
      document.activeElement as HTMLElement
    );

    await user.tab({ shift: true });

    expect(screen.getByText("Confirm")).toHaveFocus();
  });

  it("does not let Tab reach the page while processing", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>Behind the dialog</button>
        <ConfirmDialog
          isOpen={true}
          title="Test"
          message="Test"
          isProcessing={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      </>
    );

    await user.tab();

    expect(screen.getByText("Behind the dialog")).not.toHaveFocus();
  });

  it("keeps keydown inside the dialog away from page-level shortcuts", async () => {
    // 探索頁在 document 上聽「/」聚焦搜尋框；確認框開著時在框內按鍵不能觸發它
    const user = userEvent.setup();
    const pageShortcut = vi.fn();
    document.addEventListener("keydown", pageShortcut);
    try {
      render(
        <ConfirmDialog
          isOpen={true}
          title="Test"
          message="Test"
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );
      expect(screen.getByText("Cancel")).toHaveFocus();

      await user.keyboard("/");

      expect(pageShortcut).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", pageShortcut);
    }
  });
});
