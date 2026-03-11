/**
 * Unit tests for TrendArrow component
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrendArrow } from "../TrendArrow";

describe("TrendArrow", () => {
  it("shows up arrow for positive trend", () => {
    render(<TrendArrow trend={1} />);

    const arrow = screen.getByText("↑");
    expect(arrow).toBeInTheDocument();
    expect(arrow).toHaveClass("trend-arrow-up");
  });

  it("shows down arrow for negative trend", () => {
    render(<TrendArrow trend={-1} />);

    const arrow = screen.getByText("↓");
    expect(arrow).toBeInTheDocument();
    expect(arrow).toHaveClass("trend-arrow-down");
  });

  it("shows horizontal arrow for zero trend", () => {
    render(<TrendArrow trend={0} />);

    const arrow = screen.getByText("→");
    expect(arrow).toBeInTheDocument();
    expect(arrow).toHaveClass("trend-arrow-neutral");
  });

  it("shows dash for null trend", () => {
    render(<TrendArrow trend={null} />);

    const dash = screen.getByText("—");
    expect(dash).toBeInTheDocument();
    expect(dash).toHaveClass("trend-arrow-neutral");
  });

  it("applies small size class", () => {
    render(<TrendArrow trend={1} size="sm" />);

    const arrow = screen.getByText("↑");
    expect(arrow).toHaveClass("trend-arrow-sm");
  });

  it("applies medium size class by default", () => {
    render(<TrendArrow trend={1} />);

    const arrow = screen.getByText("↑");
    expect(arrow).toHaveClass("trend-arrow-md");
  });

  it("applies large size class", () => {
    render(<TrendArrow trend={1} size="lg" />);

    const arrow = screen.getByText("↑");
    expect(arrow).toHaveClass("trend-arrow-lg");
  });
});
