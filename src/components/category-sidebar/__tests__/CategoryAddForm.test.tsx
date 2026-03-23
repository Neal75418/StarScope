import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { CategoryAddForm } from "../CategoryAddForm";

describe("CategoryAddForm", () => {
  const mockOnSubmit = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderForm() {
    return render(<CategoryAddForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
  }

  it("renders input and buttons", () => {
    renderForm();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add|新增/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancel|取消/ })).toBeInTheDocument();
  });

  it("submit button is disabled when input is empty", () => {
    renderForm();
    expect(screen.getByRole("button", { name: /Add|新增/ })).toBeDisabled();
  });

  it("calls onSubmit and onCancel on success", async () => {
    const user = userEvent.setup();
    mockOnSubmit.mockResolvedValue(true);
    renderForm();

    await user.type(screen.getByRole("textbox"), "My Category");
    await user.click(screen.getByRole("button", { name: /Add|新增/ }));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith("My Category");
      expect(mockOnCancel).toHaveBeenCalled();
    });
  });

  it("shows error when onSubmit returns false", async () => {
    const user = userEvent.setup();
    mockOnSubmit.mockResolvedValue(false);
    renderForm();

    await user.type(screen.getByRole("textbox"), "Bad Name");
    await user.click(screen.getByRole("button", { name: /Add|新增/ }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(mockOnCancel).not.toHaveBeenCalled();
  });

  it("shows error and re-enables form when onSubmit throws", async () => {
    const user = userEvent.setup();
    mockOnSubmit.mockRejectedValue(new Error("Network error"));
    renderForm();

    await user.type(screen.getByRole("textbox"), "Crash");
    await user.click(screen.getByRole("button", { name: /Add|新增/ }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    // Form should not be stuck in disabled state
    expect(screen.getByRole("textbox")).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /Add|新增/ })).not.toBeDisabled();
  });

  it("disables controls while submitting", async () => {
    const user = userEvent.setup();
    let resolveSubmit: ((value: boolean) => void) | undefined;
    mockOnSubmit.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveSubmit = resolve;
      })
    );
    renderForm();

    await user.type(screen.getByRole("textbox"), "Test");
    await user.click(screen.getByRole("button", { name: /Add|新增/ }));

    // All controls should be disabled during submit
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Loading|載入/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Cancel|取消/ })).toBeDisabled();

    // Resolve to clean up
    resolveSubmit?.(true);
  });

  it("cancel clears input and calls onCancel", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByRole("textbox"), "Draft");
    await user.click(screen.getByRole("button", { name: /Cancel|取消/ }));

    expect(mockOnCancel).toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue("");
  });
});
