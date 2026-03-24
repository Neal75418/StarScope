import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MetricsTable } from "../MetricsTable";
import type { ComparisonRepoData, ChartDataPoint } from "../../../api/types";

vi.mock("../../trends/BreakoutBadge", () => ({
  BreakoutBadge: () => <span data-testid="breakout-badge" />,
}));

const mockT = {
  compare: {
    metrics: "Metrics",
    columns: {
      repo: "Repository",
      stars: "Stars",
      delta7d: "7d Delta",
      delta30d: "30d Delta",
      velocity: "Velocity",
      acceleration: "Accel",
      trend: "Trend",
    },
    trendLabels: { up: "Up", stable: "Stable", down: "Down" },
  },
};

function makeDataPoint(overrides: Partial<ChartDataPoint> = {}): ChartDataPoint {
  return { date: "2024-01-01", stars: 100, forks: 10, open_issues: 0, ...overrides };
}

function makeComparisonRepo(overrides: Partial<ComparisonRepoData> = {}): ComparisonRepoData {
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

describe("MetricsTable", () => {
  it("renders table headers", () => {
    render(<MetricsTable repos={[makeComparisonRepo()]} t={mockT as never} />);
    expect(screen.getByText("Repository")).toBeInTheDocument();
    expect(screen.getByText("Stars")).toBeInTheDocument();
    expect(screen.getByText("Velocity")).toBeInTheDocument();
    expect(screen.getByText("Accel")).toBeInTheDocument();
    expect(screen.getByText("Trend")).toBeInTheDocument();
  });

  it("renders repo name with color dot", () => {
    render(<MetricsTable repos={[makeComparisonRepo()]} t={mockT as never} />);
    expect(screen.getByText("facebook/react")).toBeInTheDocument();
  });

  it("renders formatted star count", () => {
    render(
      <MetricsTable repos={[makeComparisonRepo({ current_stars: 200000 })]} t={mockT as never} />
    );
    // formatNumber(200000) → "200,000" or "200k" — look for the text
    expect(screen.getByText(/200/)).toBeInTheDocument();
  });

  it("renders velocity and acceleration", () => {
    render(
      <MetricsTable
        repos={[makeComparisonRepo({ velocity: 14.3, acceleration: 0.5 })]}
        t={mockT as never}
      />
    );
    expect(screen.getByText("14.3")).toBeInTheDocument();
    expect(screen.getByText("0.5")).toBeInTheDocument();
  });

  it("renders dash for null values", () => {
    render(
      <MetricsTable
        repos={[makeComparisonRepo({ velocity: null, acceleration: null, trend: null })]}
        t={mockT as never}
      />
    );
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBe(3);
  });

  it("sorts repos by velocity descending", () => {
    const repos = [
      makeComparisonRepo({ repo_id: 1, repo_name: "slow/repo", velocity: 5.0 }),
      makeComparisonRepo({ repo_id: 2, repo_name: "fast/repo", velocity: 20.0 }),
    ];
    render(<MetricsTable repos={repos} t={mockT as never} />);
    const rows = screen.getAllByRole("row");
    // Header + 2 data rows
    expect(rows).toHaveLength(3);
    // fast/repo should be first (highest velocity)
    expect(rows[1]).toHaveTextContent("fast/repo");
    expect(rows[2]).toHaveTextContent("slow/repo");
  });

  it("renders trend arrow for trend values", () => {
    render(<MetricsTable repos={[makeComparisonRepo({ trend: 1 })]} t={mockT as never} />);
    expect(screen.getByText("↑")).toBeInTheDocument();
  });

  it("renders delta values with trend classes", () => {
    const { container } = render(
      <MetricsTable repos={[makeComparisonRepo({ stars_delta_7d: 100 })]} t={mockT as never} />
    );
    const trendUp = container.querySelector(".trend-up");
    expect(trendUp).toBeInTheDocument();
  });

  it("renders trend-down class for negative deltas", () => {
    const { container } = render(
      <MetricsTable
        repos={[makeComparisonRepo({ stars_delta_7d: -50, stars_delta_30d: -200 })]}
        t={mockT as never}
      />
    );
    const trendDown = container.querySelectorAll(".trend-down");
    expect(trendDown.length).toBe(2);
  });

  it("renders dash for null delta values", () => {
    render(
      <MetricsTable
        repos={[makeComparisonRepo({ stars_delta_7d: null, stars_delta_30d: null })]}
        t={mockT as never}
      />
    );
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBe(2);
  });

  it("renders zero delta without trend class", () => {
    const { container } = render(
      <MetricsTable
        repos={[makeComparisonRepo({ stars_delta_7d: 0, stars_delta_30d: 0 })]}
        t={mockT as never}
      />
    );
    // Zero deltas should have no trend class
    expect(container.querySelector(".trend-up")).not.toBeInTheDocument();
    expect(container.querySelector(".trend-down")).not.toBeInTheDocument();
  });

  it("renders breakout badge when signalsByRepoId is provided", () => {
    render(
      <MetricsTable
        repos={[makeComparisonRepo({ repo_id: 1 })]}
        t={mockT as never}
        signalsByRepoId={{
          1: [
            {
              id: 1,
              repo_id: 1,
              repo_name: "facebook/react",
              signal_type: "breakout",
              severity: "high",
              description: "Stars breakout detected",
              velocity_value: 50,
              star_count: 200000,
              percentile_rank: 99,
              detected_at: "2024-01-01T00:00:00Z",
              expires_at: "2024-02-01T00:00:00Z",
              acknowledged: false,
              acknowledged_at: null,
            },
          ],
        }}
      />
    );
    expect(screen.getByTestId("breakout-badge")).toBeInTheDocument();
  });

  it("handles null velocity in sort", () => {
    const repos = [
      makeComparisonRepo({ repo_id: 1, repo_name: "null/vel", velocity: null }),
      makeComparisonRepo({ repo_id: 2, repo_name: "has/vel", velocity: 10.0 }),
    ];
    render(<MetricsTable repos={repos} t={mockT as never} />);
    const rows = screen.getAllByRole("row");
    // has/vel (10.0) should sort before null/vel (0 fallback)
    expect(rows[1]).toHaveTextContent("has/vel");
    expect(rows[2]).toHaveTextContent("null/vel");
  });

  it("renders fallback arrow for unrecognized trend", () => {
    render(
      <MetricsTable repos={[makeComparisonRepo({ trend: 999 as never })]} t={mockT as never} />
    );
    expect(screen.getByText("→")).toBeInTheDocument();
  });
});
