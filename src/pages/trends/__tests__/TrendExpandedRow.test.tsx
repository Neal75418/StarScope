import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { TrendExpandedRow } from "../TrendExpandedRow";
import type { TrendingRepo } from "../../../api/client";
import type { ReactNode } from "react";

vi.mock("../../../components/StarsChart", () => ({
  StarsChart: ({ repoId }: { repoId: number }) => (
    <div data-testid="stars-chart">Chart for {repoId}</div>
  ),
}));

vi.mock("../../../components/TrendArrow", () => ({
  TrendArrow: ({ trend }: { trend: number | null }) => (
    <span data-testid="trend-arrow">{trend ?? "\u2014"}</span>
  ),
}));

function makeTrending(overrides: Partial<TrendingRepo> = {}): TrendingRepo {
  return {
    id: 1,
    owner: "facebook",
    name: "react",
    full_name: "facebook/react",
    url: "https://github.com/facebook/react",
    description: "A JavaScript library for building user interfaces",
    language: "JavaScript",
    stars: 200000,
    stars_delta_7d: 500,
    stars_delta_30d: 2000,
    velocity: 71.4,
    acceleration: 5.2,
    trend: 1,
    forks_delta_7d: null,
    forks_delta_30d: null,
    issues_delta_7d: null,
    issues_delta_30d: null,
    rank: 1,
    ...overrides,
  };
}

function renderInTable(ui: ReactNode) {
  return render(
    <table>
      <tbody>{ui}</tbody>
    </table>
  );
}

describe("TrendExpandedRow", () => {
  it("renders chart for the repo", () => {
    renderInTable(<TrendExpandedRow repo={makeTrending()} onClose={vi.fn()} />);
    expect(screen.getByTestId("stars-chart")).toBeInTheDocument();
    expect(screen.getByText("Chart for 1")).toBeInTheDocument();
  });

  it("renders repo description", () => {
    renderInTable(
      <TrendExpandedRow repo={makeTrending({ description: "A great library" })} onClose={vi.fn()} />
    );
    expect(screen.getByText("A great library")).toBeInTheDocument();
  });

  it("shows no-description message when description is null", () => {
    renderInTable(
      <TrendExpandedRow repo={makeTrending({ description: null })} onClose={vi.fn()} />
    );
    expect(screen.getByText("No description available.")).toBeInTheDocument();
  });

  it("renders metric chips", () => {
    renderInTable(<TrendExpandedRow repo={makeTrending()} onClose={vi.fn()} />);
    expect(screen.getByText("200.0K")).toBeInTheDocument();
    expect(screen.getByText("71.4")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderInTable(<TrendExpandedRow repo={makeTrending()} onClose={onClose} />);
    await user.click(screen.getByLabelText("Collapse"));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders with correct test id", () => {
    renderInTable(<TrendExpandedRow repo={makeTrending({ id: 42 })} onClose={vi.fn()} />);
    expect(screen.getByTestId("trend-expanded-42")).toBeInTheDocument();
  });

  it("renders language badge in metrics", () => {
    renderInTable(<TrendExpandedRow repo={makeTrending({ language: "Rust" })} onClose={vi.fn()} />);
    expect(screen.getByText("Rust")).toBeInTheDocument();
  });
});
