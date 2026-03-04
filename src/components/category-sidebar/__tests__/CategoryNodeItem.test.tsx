import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { CategoryNodeItem } from "../CategoryNodeItem";
import type { CategoryTreeNode } from "../../../api/client";

function makeNode(overrides: Partial<CategoryTreeNode> = {}): CategoryTreeNode {
  return {
    id: 1,
    name: "Frontend",
    description: null,
    icon: null,
    color: null,
    sort_order: 0,
    repo_count: 5,
    children: [],
    ...overrides,
  };
}

describe("CategoryNodeItem", () => {
  const defaultProps = {
    node: makeNode(),
    depth: 0,
    isSelected: false,
    isExpanded: false,
    hasChildren: false,
    onSelect: vi.fn(),
    onToggleExpand: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders node name and repo count", () => {
    render(<CategoryNodeItem {...defaultProps} />);
    expect(screen.getByText("Frontend")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("calls onSelect when clicked", async () => {
    const user = userEvent.setup();
    render(<CategoryNodeItem {...defaultProps} />);
    await user.click(screen.getByText("Frontend"));
    expect(defaultProps.onSelect).toHaveBeenCalledWith(1);
  });

  it("calls onSelect on Enter key", () => {
    const { container } = render(<CategoryNodeItem {...defaultProps} />);
    const item = container.querySelector(".category-item") as HTMLElement;
    fireEvent.keyDown(item, { key: "Enter" });
    expect(defaultProps.onSelect).toHaveBeenCalledWith(1);
  });

  it("calls onSelect on Space key", () => {
    const { container } = render(<CategoryNodeItem {...defaultProps} />);
    const item = container.querySelector(".category-item") as HTMLElement;
    fireEvent.keyDown(item, { key: " " });
    expect(defaultProps.onSelect).toHaveBeenCalledWith(1);
  });

  it("does not call onSelect on other keys", () => {
    const { container } = render(<CategoryNodeItem {...defaultProps} />);
    const item = container.querySelector(".category-item") as HTMLElement;
    fireEvent.keyDown(item, { key: "Escape" });
    expect(defaultProps.onSelect).not.toHaveBeenCalled();
  });

  it("shows expand button when hasChildren is true", () => {
    render(<CategoryNodeItem {...defaultProps} hasChildren={true} />);
    expect(screen.getByLabelText("Expand")).toBeInTheDocument();
  });

  it("shows collapse indicator when expanded", () => {
    render(<CategoryNodeItem {...defaultProps} hasChildren={true} isExpanded={true} />);
    expect(screen.getByLabelText("Collapse")).toBeInTheDocument();
  });

  it("calls onToggleExpand when expand button clicked", async () => {
    const user = userEvent.setup();
    render(<CategoryNodeItem {...defaultProps} hasChildren={true} />);
    await user.click(screen.getByLabelText("Expand"));
    expect(defaultProps.onToggleExpand).toHaveBeenCalledWith(1, expect.any(Object));
  });

  it("calls onEdit when edit button clicked", async () => {
    const user = userEvent.setup();
    render(<CategoryNodeItem {...defaultProps} />);
    await user.click(screen.getByTitle("Edit category"));
    expect(defaultProps.onEdit).toHaveBeenCalledWith(defaultProps.node, expect.any(Object));
  });

  it("calls onDelete when delete button clicked", async () => {
    const user = userEvent.setup();
    render(<CategoryNodeItem {...defaultProps} />);
    await user.click(screen.getByTitle("Delete category"));
    expect(defaultProps.onDelete).toHaveBeenCalledWith(1, expect.any(Object));
  });

  it("applies selected class when isSelected", () => {
    const { container } = render(<CategoryNodeItem {...defaultProps} isSelected={true} />);
    expect(container.querySelector(".category-item.selected")).toBeInTheDocument();
  });

  it("renders icon when node has icon", () => {
    render(<CategoryNodeItem {...defaultProps} node={makeNode({ icon: "🎨" })} />);
    expect(screen.getByText("🎨")).toBeInTheDocument();
  });

  it("applies color to name when node has color", () => {
    render(<CategoryNodeItem {...defaultProps} node={makeNode({ color: "#ff0000" })} />);
    const nameEl = screen.getByText("Frontend");
    expect(nameEl).toHaveStyle({ color: "#ff0000" });
  });

  it("indents based on depth", () => {
    const { container } = render(<CategoryNodeItem {...defaultProps} depth={2} />);
    const item = container.querySelector(".category-item");
    expect(item).toHaveStyle({ paddingLeft: "40px" }); // 2 * 16 + 8
  });
});
