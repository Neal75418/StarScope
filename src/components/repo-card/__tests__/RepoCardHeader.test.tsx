import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { RepoCardHeader } from "../RepoCardHeader";
import type { RepoWithSignals } from "../../../api/client";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("../../CommitActivityBadge", () => ({
  CommitActivityBadge: () => <span data-testid="commit-badge" />,
}));

vi.mock("../../LanguagesBadge", () => ({
  LanguagesBadge: () => <span data-testid="languages-badge" />,
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

describe("RepoCardHeader", () => {
  const defaultProps = {
    repo: makeRepo(),
    showChart: false,
    showSimilar: false,
    isLoading: false,
    onToggleChart: vi.fn(),
    onToggleSimilar: vi.fn(),
    onFetch: vi.fn(),
    onRemove: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("displays repo full name as link", () => {
    render(<RepoCardHeader {...defaultProps} />);
    expect(screen.getByText("facebook/react")).toBeInTheDocument();
    expect(screen.getByText("facebook/react").closest("a")).toHaveAttribute(
      "href",
      "https://github.com/facebook/react"
    );
  });

  it("displays language badge", () => {
    render(<RepoCardHeader {...defaultProps} />);
    expect(screen.getByText("JavaScript")).toBeInTheDocument();
  });

  it("renders all action buttons", () => {
    render(<RepoCardHeader {...defaultProps} />);
    expect(screen.getByTitle("Chart")).toBeInTheDocument();
    expect(screen.getByTitle("Similar")).toBeInTheDocument();
    expect(screen.getByTitle("Refresh")).toBeInTheDocument();
    expect(screen.getByTitle("Remove")).toBeInTheDocument();
  });

  it("calls onToggleChart when chart button clicked", async () => {
    const user = userEvent.setup();
    render(<RepoCardHeader {...defaultProps} />);
    await user.click(screen.getByTitle("Chart"));
    expect(defaultProps.onToggleChart).toHaveBeenCalled();
  });

  it("disables refresh and remove buttons when loading", () => {
    render(<RepoCardHeader {...defaultProps} isLoading={true} />);
    expect(screen.getByTitle("Refresh")).toBeDisabled();
    expect(screen.getByTitle("Remove")).toBeDisabled();
  });

  it("shows signal count badge when activeSignalCount > 0", () => {
    render(<RepoCardHeader {...defaultProps} activeSignalCount={3} />);
    expect(screen.getByText("⚡ 3")).toBeInTheDocument();
  });

  it("does not show signal badge when activeSignalCount is 0", () => {
    render(<RepoCardHeader {...defaultProps} activeSignalCount={0} />);
    expect(screen.queryByText(/⚡/)).not.toBeInTheDocument();
  });

  it("shows remove from category button when selectedCategoryId is set", () => {
    const onRemoveFromCategory = vi.fn();
    render(
      <RepoCardHeader
        {...defaultProps}
        selectedCategoryId={5}
        onRemoveFromCategory={onRemoveFromCategory}
      />
    );
    expect(screen.getByTitle("Remove from Category")).toBeInTheDocument();
  });
});
