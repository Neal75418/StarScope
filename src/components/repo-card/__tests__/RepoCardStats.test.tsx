import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RepoCardStats } from "../RepoCardStats";
import type { RepoWithSignals } from "../../../api/client";

vi.mock("../../../i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../i18n")>();
  return {
    ...actual,
    useI18n: () => ({
      t: {
        repo: {
          stars: "Stars",
          velocity: "Velocity",
          trend: "Trend",
        },
      },
    }),
  };
});

vi.mock("../../TrendArrow", () => ({
  TrendArrow: ({ trend }: { trend: number | null }) => (
    <span data-testid="trend-arrow">
      {trend === null ? "—" : trend > 0 ? "↑" : trend < 0 ? "↓" : "→"}
    </span>
  ),
}));

function makeRepo(overrides: Partial<RepoWithSignals> = {}): RepoWithSignals {
  return {
    id: 1,
    owner: "facebook",
    name: "react",
    full_name: "facebook/react",
    url: "https://github.com/facebook/react",
    description: "A JavaScript library",
    language: "JavaScript",
    added_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-06-01T00:00:00Z",
    stars: 200000,
    forks: 40000,
    stars_delta_7d: 500,
    stars_delta_30d: 2000,
    velocity: 71.4,
    acceleration: 5.2,
    trend: 1,
    last_fetched: "2024-06-01T00:00:00Z",
    ...overrides,
  };
}

describe("RepoCardStats", () => {
  it("renders star count", () => {
    render(<RepoCardStats repo={makeRepo()} />);
    expect(screen.getByText("200.0k")).toBeInTheDocument();
  });

  it("renders 7d and 30d deltas", () => {
    render(<RepoCardStats repo={makeRepo()} />);
    expect(screen.getByText("+500")).toBeInTheDocument();
    expect(screen.getByText("+2.0k")).toBeInTheDocument();
  });

  it("renders velocity", () => {
    render(<RepoCardStats repo={makeRepo()} />);
    expect(screen.getByText("71.4/day")).toBeInTheDocument();
  });

  it("renders trend arrow", () => {
    render(<RepoCardStats repo={makeRepo({ trend: 1 })} />);
    expect(screen.getByTestId("trend-arrow")).toHaveTextContent("↑");
  });

  it("displays dash for null values", () => {
    render(
      <RepoCardStats
        repo={makeRepo({ stars: null, stars_delta_7d: null, velocity: null, trend: null })}
      />
    );
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });
});
