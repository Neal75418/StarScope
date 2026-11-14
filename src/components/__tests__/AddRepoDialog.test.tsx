/**
 * Unit tests for AddRepoDialog component
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { AddRepoDialog } from "../AddRepoDialog";

describe("AddRepoDialog", () => {
  const mockOnClose = vi.fn();
  const mockOnAdd = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <AddRepoDialog isOpen={false} onClose={mockOnClose} onAdd={mockOnAdd} />
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders dialog when isOpen is true", () => {
    render(<AddRepoDialog isOpen={true} onClose={mockOnClose} onAdd={mockOnAdd} />);

    expect(screen.getByText("Add Repository")).toBeInTheDocument();
  });

  it("shows hint and examples", () => {
    render(<AddRepoDialog isOpen={true} onClose={mockOnClose} onAdd={mockOnAdd} />);

    expect(
      screen.getByText("Enter a repository in owner/repo format or paste a GitHub URL")
    ).toBeInTheDocument();
    expect(screen.getByText("owner/repo (e.g., facebook/react)")).toBeInTheDocument();
  });

  it("has input field with placeholder", () => {
    render(<AddRepoDialog isOpen={true} onClose={mockOnClose} onAdd={mockOnAdd} />);

    const input = screen.getByPlaceholderText("owner/repo or GitHub URL");
    expect(input).toBeInTheDocument();
  });

  it("calls onClose when close button clicked", async () => {
    const user = userEvent.setup();
    render(<AddRepoDialog isOpen={true} onClose={mockOnClose} onAdd={mockOnAdd} />);

    await user.click(screen.getByLabelText("Close"));

    expect(mockOnClose).toHaveBeenCalled();
  });

  it("calls onClose when cancel button clicked", async () => {
    const user = userEvent.setup();
    render(<AddRepoDialog isOpen={true} onClose={mockOnClose} onAdd={mockOnAdd} />);

    await user.click(screen.getByText("Cancel"));

    expect(mockOnClose).toHaveBeenCalled();
  });

  it("submits form with input value", async () => {
    const user = userEvent.setup();
    mockOnAdd.mockResolvedValue(undefined);

    render(<AddRepoDialog isOpen={true} onClose={mockOnClose} onAdd={mockOnAdd} />);

    const input = screen.getByPlaceholderText("owner/repo or GitHub URL");
    await user.type(input, "facebook/react");
    await user.click(screen.getByText("Add"));

    expect(mockOnAdd).toHaveBeenCalledWith("facebook/react");
  });

  it("disables submit button when input is empty", () => {
    render(<AddRepoDialog isOpen={true} onClose={mockOnClose} onAdd={mockOnAdd} />);

    const submitBtn = screen.getByText("Add");
    expect(submitBtn).toBeDisabled();
  });

  it("enables submit button when input has value", async () => {
    const user = userEvent.setup();
    render(<AddRepoDialog isOpen={true} onClose={mockOnClose} onAdd={mockOnAdd} />);

    const input = screen.getByPlaceholderText("owner/repo or GitHub URL");
    await user.type(input, "test");

    const submitBtn = screen.getByText("Add");
    expect(submitBtn).not.toBeDisabled();
  });

  it("shows loading state", () => {
    render(
      <AddRepoDialog isOpen={true} onClose={mockOnClose} onAdd={mockOnAdd} isLoading={true} />
    );

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("owner/repo or GitHub URL")).toBeDisabled();
  });

  it("displays error message when provided", () => {
    render(
      <AddRepoDialog
        isOpen={true}
        onClose={mockOnClose}
        onAdd={mockOnAdd}
        error="Repository not found"
      />
    );

    expect(screen.getByText("Repository not found")).toBeInTheDocument();
  });

  it("preserves input after submit so user can retry on failure", async () => {
    const user = userEvent.setup();
    mockOnAdd.mockResolvedValue(undefined);

    render(<AddRepoDialog isOpen={true} onClose={mockOnClose} onAdd={mockOnAdd} />);

    const input = screen.getByPlaceholderText("owner/repo or GitHub URL") as HTMLInputElement;
    await user.type(input, "test/repo");
    await user.click(screen.getByText("Add"));

    await waitFor(() => {
      expect(mockOnAdd).toHaveBeenCalledWith("test/repo");
    });
    // Input preserved — on failure, user can edit and retry
    expect(input.value).toBe("test/repo");
  });

  it("clears input when dialog reopens", async () => {
    const user = userEvent.setup();
    mockOnAdd.mockResolvedValue(undefined);

    const { rerender } = render(
      <AddRepoDialog isOpen={true} onClose={mockOnClose} onAdd={mockOnAdd} />
    );

    const input = screen.getByPlaceholderText("owner/repo or GitHub URL") as HTMLInputElement;
    await user.type(input, "test/repo");

    // Dialog closes then reopens — input should be cleared
    rerender(<AddRepoDialog isOpen={false} onClose={mockOnClose} onAdd={mockOnAdd} />);
    rerender(<AddRepoDialog isOpen={true} onClose={mockOnClose} onAdd={mockOnAdd} />);

    const freshInput = screen.getByPlaceholderText("owner/repo or GitHub URL") as HTMLInputElement;
    expect(freshInput.value).toBe("");
  });

  it("has proper ARIA attributes", () => {
    render(<AddRepoDialog isOpen={true} onClose={mockOnClose} onAdd={mockOnAdd} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("calls onClose when overlay clicked", async () => {
    const user = userEvent.setup();
    render(<AddRepoDialog isOpen={true} onClose={mockOnClose} onAdd={mockOnAdd} />);

    await user.click(screen.getByRole("dialog").parentElement as HTMLElement);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on overlay click while loading", async () => {
    const user = userEvent.setup();
    render(
      <AddRepoDialog isOpen={true} onClose={mockOnClose} onAdd={mockOnAdd} isLoading={true} />
    );

    await user.click(screen.getByRole("dialog").parentElement as HTMLElement);

    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("stays open when a press that started in the input ends on the overlay", () => {
    // 拖曳選取輸入的文字時滑出框外才放開：瀏覽器把 click 發給共同祖先，也就是遮罩
    render(<AddRepoDialog isOpen={true} onClose={mockOnClose} onAdd={mockOnAdd} />);
    const overlay = screen.getByRole("dialog").parentElement as HTMLElement;

    fireEvent.mouseDown(screen.getByPlaceholderText("owner/repo or GitHub URL"));
    fireEvent.mouseUp(overlay);
    fireEvent.click(overlay);

    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("calls onClose on ESC key while typing in the input", async () => {
    const user = userEvent.setup();
    render(<AddRepoDialog isOpen={true} onClose={mockOnClose} onAdd={mockOnAdd} />);

    await user.type(screen.getByPlaceholderText("owner/repo or GitHub URL"), "facebook/react");
    await user.keyboard("{Escape}");

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("brings Tab back into the dialog after the user clicks its text", async () => {
    // 點框內不可聚焦的文字，焦點會落到 body；下一次 Tab 要回到框內，不是框後面的頁面
    const user = userEvent.setup();
    render(
      <>
        <button>Behind the dialog</button>
        <AddRepoDialog isOpen={true} onClose={mockOnClose} onAdd={mockOnAdd} />
      </>
    );
    await user.click(
      screen.getByText("Enter a repository in owner/repo format or paste a GitHub URL")
    );
    expect(document.body).toHaveFocus();

    await user.tab();

    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("does not close on ESC while an input method is composing in the input", () => {
    // 注音、日文等輸入法組字到一半按 Esc 是取消組字，對話框與已經打的字要留著
    render(<AddRepoDialog isOpen={true} onClose={mockOnClose} onAdd={mockOnAdd} />);

    fireEvent.keyDown(screen.getByPlaceholderText("owner/repo or GitHub URL"), {
      key: "Escape",
      isComposing: true,
    });

    expect(mockOnClose).not.toHaveBeenCalled();
  });
});
