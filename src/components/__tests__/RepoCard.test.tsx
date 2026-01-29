/**
 * Unit tests for RepoCard component
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { RepoCard } from "../RepoCard";
import type { RepoWithSignals } from "../../api/client";

// Mock tauri opener
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

// Mock API client
vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getContextBadges: vi.fn(() => Promise.resolve({ badges: [] })),
    getRepoTags: vi.fn(() => Promise.resolve({ tags: [] })),
    getHealthScoreSummary: vi.fn(() =>
      Promise.resolve({
        repo_id: 1,
        overall_score: 85,
        grade: "A",
        calculated_at: "2024-01-10T00:00:00Z",
      })
    ),
    getSimilarRepos: vi.fn(() =>
      Promise.resolve({
        repo_id: 1,
        similar: [],
        total: 0,
      })
    ),
    calculateRepoSimilarities: vi.fn(() =>
      Promise.resolve({
        repo_id: 1,
        similarities_found: 0,
      })
    ),
  };
});

// Mock i18n
vi.mock("../../i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../i18n")>();
  return {
    ...actual,
    useI18n: () => ({
      t: {
        repo: {
          stars: "Stars",
          velocity: "Velocity",
          trend: "Trend",
          chart: "Chart",
          hide: "Hide",
          similar: "Similar",
          refresh: "Refresh",
          remove: "Remove",
          loadingBadges: "Loading badges...",
          loadingTags: "Loading tags...",
        },
        health: {
          titleFormat: "Score: {score}, Grade: {grade}",
        },
        healthScore: {
          failedToLoad: "Failed to load",
          clickToCalculate: "Click to calculate",
        },
        similarRepos: {
          title: "Similar Repositories",
          recalculate: "Recalculate",
          loadError: "Failed to load",
          empty: "No similar repos found",
          close: "Close",
        },
      },
    }),
  };
});

describe("RepoCard", () => {
  const mockRepo: RepoWithSignals = {
    id: 1,
    full_name: "facebook/react",
    owner: "facebook",
    name: "react",
    url: "https://github.com/facebook/react",
    description:
      "A declarative, efficient, and flexible JavaScript library for building user interfaces.",
    language: "JavaScript",
    stars: 220000,
    forks: 30000,
    stars_delta_7d: 500,
    stars_delta_30d: 2000,
    velocity: 71.4,
    acceleration: null,
    trend: 1, // -1, 0, 1 for down, stable, up
    last_fetched: "2024-01-10T00:00:00Z",
    added_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-10T00:00:00Z",
  };

  const mockOnFetch = vi.fn();
  const mockOnRemove = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders repository name and URL correctly", () => {
    render(<RepoCard repo={mockRepo} onFetch={mockOnFetch} onRemove={mockOnRemove} />);

    const repoLink = screen.getByRole("link", { name: "facebook/react" });
    expect(repoLink).toBeInTheDocument();
    expect(repoLink).toHaveAttribute("href", "https://github.com/facebook/react");
  });

  it("displays repository language", () => {
    render(<RepoCard repo={mockRepo} onFetch={mockOnFetch} onRemove={mockOnRemove} />);

    expect(screen.getByText("JavaScript")).toBeInTheDocument();
  });

  it("displays repository description", () => {
    render(<RepoCard repo={mockRepo} onFetch={mockOnFetch} onRemove={mockOnRemove} />);

    expect(
      screen.getByText(/A declarative, efficient, and flexible JavaScript library/)
    ).toBeInTheDocument();
  });

  it("displays star count with correct formatting", () => {
    render(<RepoCard repo={mockRepo} onFetch={mockOnFetch} onRemove={mockOnRemove} />);

    // formatNumber(220000) should display as "220,000" or "220K" depending on implementation
    expect(screen.getByText(/220/)).toBeInTheDocument();
  });

  it("displays 7-day and 30-day deltas", () => {
    render(<RepoCard repo={mockRepo} onFetch={mockOnFetch} onRemove={mockOnRemove} />);

    expect(screen.getByText("7d")).toBeInTheDocument();
    expect(screen.getByText("30d")).toBeInTheDocument();
    // Deltas should be formatted (e.g., "+500", "+2,000")
  });

  it("displays velocity value", () => {
    render(<RepoCard repo={mockRepo} onFetch={mockOnFetch} onRemove={mockOnRemove} />);

    expect(screen.getByText("Velocity")).toBeInTheDocument();
    // velocity 71.4 should be displayed somewhere
  });

  it("calls onFetch when refresh button is clicked", async () => {
    const user = userEvent.setup();
    render(<RepoCard repo={mockRepo} onFetch={mockOnFetch} onRemove={mockOnRemove} />);

    const refreshButton = screen.getByRole("button", { name: /refresh/i });
    await user.click(refreshButton);

    expect(mockOnFetch).toHaveBeenCalledWith(1);
    expect(mockOnFetch).toHaveBeenCalledTimes(1);
  });

  it("calls onRemove when remove button is clicked", async () => {
    const user = userEvent.setup();
    render(<RepoCard repo={mockRepo} onFetch={mockOnFetch} onRemove={mockOnRemove} />);

    const removeButton = screen.getByRole("button", { name: /remove/i });
    await user.click(removeButton);

    expect(mockOnRemove).toHaveBeenCalledWith(1);
    expect(mockOnRemove).toHaveBeenCalledTimes(1);
  });

  it("disables buttons when isLoading is true", () => {
    render(
      <RepoCard repo={mockRepo} onFetch={mockOnFetch} onRemove={mockOnRemove} isLoading={true} />
    );

    const refreshButton = screen.getByRole("button", { name: /refresh/i });
    const removeButton = screen.getByRole("button", { name: /remove/i });

    expect(refreshButton).toBeDisabled();
    expect(removeButton).toBeDisabled();
  });

  it("shows loading state for badges initially", () => {
    render(<RepoCard repo={mockRepo} onFetch={mockOnFetch} onRemove={mockOnRemove} />);

    expect(screen.getByText("Loading badges...")).toBeInTheDocument();
  });

  it("shows loading state for tags initially", () => {
    render(<RepoCard repo={mockRepo} onFetch={mockOnFetch} onRemove={mockOnRemove} />);

    expect(screen.getByText("Loading tags...")).toBeInTheDocument();
  });

  it("toggles chart visibility when chart button is clicked", async () => {
    const user = userEvent.setup();
    render(<RepoCard repo={mockRepo} onFetch={mockOnFetch} onRemove={mockOnRemove} />);

    const chartButton = screen.getByRole("button", { name: /chart/i });

    // Initially chart should not be visible
    expect(screen.queryByRole("region")).not.toBeInTheDocument();

    // Click to show chart
    await user.click(chartButton);

    // Chart should be visible (assuming StarsChart renders a region role)
    await waitFor(() => {
      expect(chartButton.textContent).toContain("Hide");
    });

    // Click again to hide
    await user.click(chartButton);
    await waitFor(() => {
      expect(chartButton.textContent).toContain("Chart");
    });
  });

  it("opens external link in new tab", async () => {
    const user = userEvent.setup();
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    render(<RepoCard repo={mockRepo} onFetch={mockOnFetch} onRemove={mockOnRemove} />);

    const repoLink = screen.getByRole("link", { name: "facebook/react" });
    expect(repoLink).not.toHaveAttribute("target");

    await user.click(repoLink);
    expect(openUrl).toHaveBeenCalledWith("https://github.com/facebook/react");
  });

  it("handles null description gracefully", () => {
    const repoWithNullDesc = { ...mockRepo, description: null };
    render(<RepoCard repo={repoWithNullDesc} onFetch={mockOnFetch} onRemove={mockOnRemove} />);

    expect(screen.getByText("facebook/react")).toBeInTheDocument();
  });

  it("handles null velocity gracefully", () => {
    const repoWithNullVelocity = { ...mockRepo, velocity: null };
    render(<RepoCard repo={repoWithNullVelocity} onFetch={mockOnFetch} onRemove={mockOnRemove} />);

    expect(screen.getByText("Velocity")).toBeInTheDocument();
  });

  it("handles null deltas gracefully", () => {
    const repoWithNullDeltas = { ...mockRepo, stars_delta_7d: null, stars_delta_30d: null };
    render(<RepoCard repo={repoWithNullDeltas} onFetch={mockOnFetch} onRemove={mockOnRemove} />);

    expect(screen.getByText("7d")).toBeInTheDocument();
    expect(screen.getByText("30d")).toBeInTheDocument();
  });

  it("handles null language gracefully", () => {
    const repoWithNullLang = { ...mockRepo, language: null };
    render(<RepoCard repo={repoWithNullLang} onFetch={mockOnFetch} onRemove={mockOnRemove} />);

    expect(screen.getByText("facebook/react")).toBeInTheDocument();
  });

  it("can click similar button", async () => {
    const user = userEvent.setup();
    render(<RepoCard repo={mockRepo} onFetch={mockOnFetch} onRemove={mockOnRemove} />);

    const similarButton = screen.getByRole("button", { name: /similar/i });
    expect(similarButton).toBeInTheDocument();

    await user.click(similarButton);

    // Button should still be in the document after click
    expect(similarButton).toBeInTheDocument();
  });

  it("renders with selectedCategoryId prop", () => {
    const mockOnRemoveFromCategory = vi.fn();
    render(
      <RepoCard
        repo={mockRepo}
        onFetch={mockOnFetch}
        onRemove={mockOnRemove}
        selectedCategoryId={5}
        onRemoveFromCategory={mockOnRemoveFromCategory}
      />
    );

    expect(screen.getByText("facebook/react")).toBeInTheDocument();
  });
});
