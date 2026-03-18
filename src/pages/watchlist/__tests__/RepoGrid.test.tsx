import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RepoGrid } from "../RepoGrid";
import type { RepoWithSignals } from "../../../api/client";

vi.mock("../../../components/RepoCard", () => ({
  RepoCard: ({ repo }: { repo: RepoWithSignals }) => (
    <div data-testid={`repo-card-${repo.id}`}>{repo.full_name}</div>
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
    forks_delta_7d: null,
    forks_delta_30d: null,
    issues_delta_7d: null,
    issues_delta_30d: null,
    last_fetched: "2024-06-01T00:00:00Z",
    ...overrides,
  };
}

describe("RepoGrid", () => {
  const defaultProps = {
    repos: [makeRepo({ id: 1 }), makeRepo({ id: 2, full_name: "vuejs/vue" })],
    loadingRepoId: null,
    onFetch: vi.fn(),
    onRemove: vi.fn(),
    batchData: {},
    onVisibleRangeChange: vi.fn(),
  };

  it("renders repo cards in grid layout", () => {
    render(<RepoGrid {...defaultProps} />);
    expect(screen.getByTestId("repo-grid")).toBeInTheDocument();
    expect(screen.getByTestId("repo-card-1")).toBeInTheDocument();
    expect(screen.getByTestId("repo-card-2")).toBeInTheDocument();
  });

  it("sets visible range to full list on mount", () => {
    render(<RepoGrid {...defaultProps} />);
    expect(defaultProps.onVisibleRangeChange).toHaveBeenCalledWith({
      start: 0,
      stop: 2,
    });
  });

  it("renders empty grid when no repos", () => {
    render(<RepoGrid {...defaultProps} repos={[]} />);
    expect(screen.getByTestId("repo-grid")).toBeInTheDocument();
    expect(screen.queryByTestId("repo-card-1")).not.toBeInTheDocument();
  });
});
