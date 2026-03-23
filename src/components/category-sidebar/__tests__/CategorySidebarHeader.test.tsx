import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { CategorySidebarHeader } from "../CategorySidebarHeader";

vi.mock("../../../i18n", () => ({
  useI18n: () => ({
    t: {
      categories: {
        title: "Categories",
        addCategory: "Add Category",
      },
    },
  }),
}));

describe("CategorySidebarHeader", () => {
  it("renders title and toggle button", () => {
    render(<CategorySidebarHeader showAddForm={false} onToggleAddForm={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Add Category" })).toBeInTheDocument();
  });

  it("shows aria-expanded=false when form is hidden", () => {
    render(<CategorySidebarHeader showAddForm={false} onToggleAddForm={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Add Category" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });

  it("shows aria-expanded=true when form is visible", () => {
    render(<CategorySidebarHeader showAddForm={true} onToggleAddForm={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Add Category" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });

  it("shows + when form is hidden and − when visible", () => {
    const { rerender } = render(
      <CategorySidebarHeader showAddForm={false} onToggleAddForm={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: "Add Category" })).toHaveTextContent("+");

    rerender(<CategorySidebarHeader showAddForm={true} onToggleAddForm={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Add Category" })).toHaveTextContent("−");
  });

  it("calls onToggleAddForm when clicked", async () => {
    const onToggle = vi.fn();
    render(<CategorySidebarHeader showAddForm={false} onToggleAddForm={onToggle} />);
    await userEvent.click(screen.getByRole("button", { name: "Add Category" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
