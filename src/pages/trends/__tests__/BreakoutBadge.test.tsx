import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BreakoutBadge } from "../BreakoutBadge";
import type { EarlySignal } from "../../../api/types";

vi.mock("../../../i18n", () => ({
  useI18n: () => ({
    t: {
      trends: {
        breakouts: {
          more: "+{count} more",
          types: {
            breakout: "Breakout",
            sudden_spike: "Spike",
            rising_star: "Rising",
            viral_hn: "HN Viral",
          },
        },
      },
    },
  }),
}));

function makeSignal(overrides: Partial<EarlySignal> = {}): EarlySignal {
  return {
    id: 1,
    repo_id: 1,
    repo_name: "foo/bar",
    signal_type: "breakout",
    severity: "high",
    description: "Breakout detected",
    velocity_value: 50,
    star_count: 1000,
    percentile_rank: 99,
    detected_at: "2024-01-01T00:00:00Z",
    expires_at: null,
    acknowledged: false,
    acknowledged_at: null,
    ...overrides,
  };
}

describe("BreakoutBadge", () => {
  it("renders nothing when signals array is empty", () => {
    const { container } = render(<BreakoutBadge signals={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when all signals are acknowledged", () => {
    const { container } = render(
      <BreakoutBadge
        signals={[
          makeSignal({ acknowledged: true }),
          makeSignal({ id: 2, signal_type: "rising_star", acknowledged: true }),
        ]}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders a single badge for one active signal", () => {
    render(<BreakoutBadge signals={[makeSignal()]} />);
    expect(screen.getByTestId("breakout-badges")).toBeInTheDocument();
    expect(screen.getByText("Breakout")).toBeInTheDocument();
  });

  it("renders up to 2 badges and shows '+N more' for extras", () => {
    const signals = [
      makeSignal({ id: 1, signal_type: "breakout" }),
      makeSignal({ id: 2, signal_type: "sudden_spike" }),
      makeSignal({ id: 3, signal_type: "rising_star" }),
      makeSignal({ id: 4, signal_type: "viral_hn" }),
    ];

    render(<BreakoutBadge signals={signals} />);

    // First 2 unique types shown
    expect(screen.getByText("Breakout")).toBeInTheDocument();
    expect(screen.getByText("Spike")).toBeInTheDocument();

    // "+2 more" for the remaining 2 types
    expect(screen.getByText("+2 more")).toBeInTheDocument();
  });

  it("deduplicates signals by type", () => {
    const signals = [
      makeSignal({ id: 1, signal_type: "breakout" }),
      makeSignal({ id: 2, signal_type: "breakout" }),
      makeSignal({ id: 3, signal_type: "breakout" }),
    ];

    render(<BreakoutBadge signals={signals} />);

    // Only one "Breakout" badge even though there are 3 signals
    const badges = screen.getAllByText("Breakout");
    expect(badges).toHaveLength(1);
    expect(screen.queryByText(/\+\d+ more/)).not.toBeInTheDocument();
  });

  it("applies correct CSS class for each signal type", () => {
    const signals = [
      makeSignal({ id: 1, signal_type: "sudden_spike" }),
      makeSignal({ id: 2, signal_type: "viral_hn" }),
    ];

    render(<BreakoutBadge signals={signals} />);

    const spike = screen.getByText("Spike");
    expect(spike.className).toContain("breakout-badge-sudden_spike");

    const viral = screen.getByText("HN Viral");
    expect(viral.className).toContain("breakout-badge-viral_hn");
  });

  it("sets title attribute from signal description", () => {
    const signals = [makeSignal({ description: "Testing tooltip" })];

    render(<BreakoutBadge signals={signals} />);

    const badge = screen.getByText("Breakout");
    expect(badge).toHaveAttribute("title", "Testing tooltip");
  });

  it("exposes description via aria-describedby and sr-only span", () => {
    const signals = [makeSignal({ description: "Velocity exceeds threshold" })];
    render(<BreakoutBadge signals={signals} />);

    const badge = screen.getByText("Breakout");
    const descId = badge.getAttribute("aria-describedby") ?? "";
    expect(descId).not.toBe("");

    // sr-only span 存在且 id 對應
    const descSpan = document.getElementById(descId);
    expect(descSpan).toBeInTheDocument();
    expect(descSpan).toHaveClass("sr-only");
    expect(descSpan).toHaveTextContent("Velocity exceeds threshold");
  });

  it("omits aria-describedby when description is empty", () => {
    const signals = [makeSignal({ description: "" })];
    render(<BreakoutBadge signals={signals} />);

    const badge = screen.getByText("Breakout");
    expect(badge).not.toHaveAttribute("aria-describedby");
  });

  it("shows all signal type labels correctly", () => {
    // Test each type one at a time
    const types: Array<{ type: EarlySignal["signal_type"]; label: string }> = [
      { type: "breakout", label: "Breakout" },
      { type: "sudden_spike", label: "Spike" },
      { type: "rising_star", label: "Rising" },
      { type: "viral_hn", label: "HN Viral" },
    ];

    for (const { type, label } of types) {
      const { unmount } = render(<BreakoutBadge signals={[makeSignal({ signal_type: type })]} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });
});
