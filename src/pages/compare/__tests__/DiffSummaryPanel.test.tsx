import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiffSummaryPanel } from "../DiffSummaryPanel";
import type { ComparisonRepoData, ChartDataPoint } from "../../../api/types";

vi.mock("../../../i18n", () => ({
  useI18n: () => ({
    t: {
      compare: {
        perDay: "/day",
        diff: {
          title: "Summary",
          leader: "Leader",
          fastest: "Fastest Growing",
          mostGained: "Most Gained (7d)",
          gap: "Star Gap",
          versus: "vs",
          closing: "Closing",
          widening: "Widening",
        },
      },
    },
  }),
}));

function makeDataPoint(overrides: Partial<ChartDataPoint> = {}): ChartDataPoint {
  return { date: "2024-01-01", stars: 100, forks: 10, open_issues: 0, ...overrides };
}

function makeRepo(overrides: Partial<ComparisonRepoData> = {}): ComparisonRepoData {
  return {
    repo_id: 1,
    repo_name: "facebook/react",
    color: "#2563eb",
    data_points: [makeDataPoint()],
    current_stars: 200000,
    velocity: 14.3,
    acceleration: 0.5,
    trend: 1,
    stars_delta_7d: 100,
    stars_delta_30d: 400,
    issues_delta_7d: null,
    issues_delta_30d: null,
    ...overrides,
  };
}

describe("DiffSummaryPanel", () => {
  it("renders nothing with fewer than 2 repos", () => {
    const { container } = render(<DiffSummaryPanel repos={[makeRepo()]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders summary panel with 2 repos", () => {
    const repos = [
      makeRepo({
        repo_id: 1,
        repo_name: "facebook/react",
        current_stars: 200000,
        velocity: 14.3,
        stars_delta_7d: 100,
      }),
      makeRepo({
        repo_id: 2,
        repo_name: "vuejs/vue",
        current_stars: 180000,
        velocity: 20.1,
        stars_delta_7d: 200,
        color: "#dc2626",
      }),
    ];
    render(<DiffSummaryPanel repos={repos} />);
    expect(screen.getByTestId("diff-summary-panel")).toBeInTheDocument();
  });

  it("shows correct leader (highest current_stars)", () => {
    const repos = [
      makeRepo({ repo_id: 1, repo_name: "facebook/react", current_stars: 200000 }),
      makeRepo({ repo_id: 2, repo_name: "vuejs/vue", current_stars: 180000, color: "#dc2626" }),
    ];
    render(<DiffSummaryPanel repos={repos} />);
    const cards = screen.getAllByTestId("diff-summary-card");
    // First card = Leader
    expect(cards[0]).toHaveTextContent("Leader");
    expect(cards[0]).toHaveTextContent("facebook/react");
  });

  it("shows correct fastest (highest velocity)", () => {
    const repos = [
      makeRepo({ repo_id: 1, repo_name: "facebook/react", velocity: 14.3 }),
      makeRepo({ repo_id: 2, repo_name: "vuejs/vue", velocity: 20.1, color: "#dc2626" }),
    ];
    render(<DiffSummaryPanel repos={repos} />);
    const cards = screen.getAllByTestId("diff-summary-card");
    // Second card = Fastest Growing
    expect(cards[1]).toHaveTextContent("Fastest Growing");
    expect(cards[1]).toHaveTextContent("vuejs/vue");
  });

  it("shows correct most gained (highest stars_delta_7d)", () => {
    const repos = [
      makeRepo({ repo_id: 1, repo_name: "facebook/react", stars_delta_7d: 100 }),
      makeRepo({ repo_id: 2, repo_name: "vuejs/vue", stars_delta_7d: 300, color: "#dc2626" }),
    ];
    render(<DiffSummaryPanel repos={repos} />);
    const cards = screen.getAllByTestId("diff-summary-card");
    // Third card = Most Gained
    expect(cards[2]).toHaveTextContent("Most Gained (7d)");
    expect(cards[2]).toHaveTextContent("vuejs/vue");
  });

  it("handles null velocity gracefully", () => {
    const repos = [
      makeRepo({ repo_id: 1, velocity: null }),
      makeRepo({ repo_id: 2, velocity: null, color: "#dc2626" }),
    ];
    render(<DiffSummaryPanel repos={repos} />);
    // Should still render leader, most gained, gap, and widening (no fastest)
    const cards = screen.getAllByTestId("diff-summary-card");
    expect(cards.length).toBe(4); // leader + most gained + gap + widening
  });
});
