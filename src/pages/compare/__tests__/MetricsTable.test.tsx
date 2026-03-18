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
    expect(dashes.length).toBeGreaterThanOrEqual(3);
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
});
