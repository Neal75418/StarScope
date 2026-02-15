import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { DiscoverySearchBar } from "../DiscoverySearchBar";

describe("DiscoverySearchBar", () => {
  const mockOnSearch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders search input and button", () => {
    render(<DiscoverySearchBar onSearch={mockOnSearch} />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("shows initialQuery in the input", () => {
    render(<DiscoverySearchBar onSearch={mockOnSearch} initialQuery="react" />);
    expect(screen.getByRole("textbox")).toHaveValue("react");
  });

  it("calls onSearch with trimmed query on submit", async () => {
    const user = userEvent.setup();
    render(<DiscoverySearchBar onSearch={mockOnSearch} />);

    await user.type(screen.getByRole("textbox"), "  react  ");
    await user.click(screen.getByRole("button"));

    expect(mockOnSearch).toHaveBeenCalledWith("react");
  });

  it("does not call onSearch when query is empty", async () => {
    const user = userEvent.setup();
    render(<DiscoverySearchBar onSearch={mockOnSearch} />);

    // Button should be disabled when input is empty
    expect(screen.getByRole("button")).toBeDisabled();

    // Type whitespace only
    await user.type(screen.getByRole("textbox"), "   ");
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("disables input and button when loading", () => {
    render(<DiscoverySearchBar onSearch={mockOnSearch} loading={true} initialQuery="react" />);
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("syncs internal state when initialQuery prop changes", async () => {
    const { rerender } = render(
      <DiscoverySearchBar onSearch={mockOnSearch} initialQuery="react" />
    );
    expect(screen.getByRole("textbox")).toHaveValue("react");

    // Parent resets keyword (e.g. via "Clear All")
    rerender(<DiscoverySearchBar onSearch={mockOnSearch} initialQuery="" />);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("allows typing after initialQuery sync", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DiscoverySearchBar onSearch={mockOnSearch} initialQuery="old" />);

    // Parent resets
    rerender(<DiscoverySearchBar onSearch={mockOnSearch} initialQuery="" />);
    expect(screen.getByRole("textbox")).toHaveValue("");

    // User types new query
    await user.type(screen.getByRole("textbox"), "vue");
    await user.click(screen.getByRole("button"));
    expect(mockOnSearch).toHaveBeenCalledWith("vue");
  });

  it("submits on Enter key", async () => {
    const user = userEvent.setup();
    render(<DiscoverySearchBar onSearch={mockOnSearch} />);

    await user.type(screen.getByRole("textbox"), "rust{Enter}");
    expect(mockOnSearch).toHaveBeenCalledWith("rust");
  });
});
