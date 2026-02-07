/**
 * Unit tests for AddRepoDialog component
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

    expect(screen.getByText("Enter a repository in owner/repo format or paste a GitHub URL")).toBeInTheDocument();
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

  it("clears input after successful submit", async () => {
    const user = userEvent.setup();
    mockOnAdd.mockResolvedValue(undefined);

    render(<AddRepoDialog isOpen={true} onClose={mockOnClose} onAdd={mockOnAdd} />);

    const input = screen.getByPlaceholderText("owner/repo or GitHub URL") as HTMLInputElement;
    await user.type(input, "test/repo");
    await user.click(screen.getByText("Add"));

    await vi.waitFor(() => {
      expect(input.value).toBe("");
    });
  });

  it("has proper ARIA attributes", () => {
    render(<AddRepoDialog isOpen={true} onClose={mockOnClose} onAdd={mockOnAdd} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });
});
