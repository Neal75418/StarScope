/**
 * WidgetCustomizer 元件測試。
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WidgetCustomizer, WidgetVisibility } from "../WidgetCustomizer";

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const defaultVisibility: WidgetVisibility = {
  portfolioHealth: true,
  signalSpotlight: true,
  weeklySummary: true,
  portfolioHistory: true,
  velocityChart: true,
  languageDistribution: true,
  categorySummary: true,
  recentActivity: true,
};

describe("WidgetCustomizer", () => {
  it("opens dropdown on button click", () => {
    render(<WidgetCustomizer visibility={defaultVisibility} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("group")).toBeInTheDocument();
  });

  it("renders checkboxes for each widget", () => {
    render(<WidgetCustomizer visibility={defaultVisibility} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button"));
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(8);
    expect(checkboxes[0]).toBeChecked();
  });

  it("calls onChange when checkbox toggled", () => {
    const onChange = vi.fn();
    render(<WidgetCustomizer visibility={defaultVisibility} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button"));
    const firstCheckbox = screen.getAllByRole("checkbox")[0];
    fireEvent.click(firstCheckbox);

    expect(onChange).toHaveBeenCalledTimes(1);
    const newVisibility = onChange.mock.calls[0][0];
    expect(newVisibility.portfolioHealth).toBe(false);
  });

  it("uses role='group' not role='menu'", () => {
    render(<WidgetCustomizer visibility={defaultVisibility} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("group")).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("sets aria-expanded on trigger button", () => {
    render(<WidgetCustomizer visibility={defaultVisibility} onChange={vi.fn()} />);
    const btn = screen.getByRole("button");

    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });

  it("closes on ESC key", async () => {
    render(<WidgetCustomizer visibility={defaultVisibility} onChange={vi.fn()} />);
    const btn = screen.getByRole("button");

    fireEvent.click(btn);
    expect(screen.getByRole("group")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });
});
