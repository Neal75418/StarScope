import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { CommitActivityBadge } from "../CommitActivityBadge";
import * as apiClient from "../../api/client";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getCommitActivitySummary: vi.fn(),
    fetchCommitActivity: vi.fn(),
  };
});


describe("CommitActivityBadge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    vi.mocked(apiClient.getCommitActivitySummary).mockImplementation(() => new Promise(() => {}));

    render(<CommitActivityBadge repoId={1} />);
    expect(screen.getByText("...")).toBeInTheDocument();
    expect(screen.getByText("...")).toHaveClass("activity-badge-loading");
  });

  it("shows error badge when load fails", async () => {
    vi.mocked(apiClient.getCommitActivitySummary).mockRejectedValue(
      new apiClient.ApiError(500, "Server error")
    );

    render(<CommitActivityBadge repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText("!")).toBeInTheDocument();
    });
    expect(screen.getByText("!")).toHaveClass("activity-badge-error");
  });

  it("shows empty badge with fetch button when no data", async () => {
    vi.mocked(apiClient.getCommitActivitySummary).mockRejectedValue(
      new apiClient.ApiError(404, "Not found")
    );

    render(<CommitActivityBadge repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText("?")).toBeInTheDocument();
    });
    expect(screen.getByText("?")).toHaveClass("activity-badge-empty");
  });

  it("fetches data when empty badge clicked", async () => {
    vi.mocked(apiClient.getCommitActivitySummary).mockRejectedValue(
      new apiClient.ApiError(404, "Not found")
    );
    vi.mocked(apiClient.fetchCommitActivity).mockResolvedValue({
      repo_id: 1,
      repo_name: "test/repo",
      weeks: [],
      total_commits_52w: 0,
      avg_commits_per_week: 0,
      last_updated: null,
    });

    render(<CommitActivityBadge repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText("?")).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button"));

    expect(apiClient.fetchCommitActivity).toHaveBeenCalledWith(1);
  });

  it("shows high activity badge for ≥10 commits/week", async () => {
    vi.mocked(apiClient.getCommitActivitySummary).mockResolvedValue({
      repo_id: 1,
      avg_commits_per_week: 15,
      total_commits_52w: 780,
      last_updated: "2024-01-01T00:00:00Z",
    });

    render(<CommitActivityBadge repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText("15/wk")).toBeInTheDocument();
    });
  });

  it("shows medium activity badge for 5-9 commits/week", async () => {
    vi.mocked(apiClient.getCommitActivitySummary).mockResolvedValue({
      repo_id: 1,
      avg_commits_per_week: 7,
      total_commits_52w: 364,
      last_updated: "2024-01-01T00:00:00Z",
    });

    render(<CommitActivityBadge repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText("7/wk")).toBeInTheDocument();
    });
  });

  it("shows low activity badge for 1-4 commits/week", async () => {
    vi.mocked(apiClient.getCommitActivitySummary).mockResolvedValue({
      repo_id: 1,
      avg_commits_per_week: 2,
      total_commits_52w: 104,
      last_updated: "2024-01-01T00:00:00Z",
    });

    render(<CommitActivityBadge repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText("2/wk")).toBeInTheDocument();
    });
  });

  it("shows inactive badge for 0 commits/week", async () => {
    vi.mocked(apiClient.getCommitActivitySummary).mockResolvedValue({
      repo_id: 1,
      avg_commits_per_week: 0,
      total_commits_52w: 0,
      last_updated: "2024-01-01T00:00:00Z",
    });

    render(<CommitActivityBadge repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText("0/wk")).toBeInTheDocument();
    });
  });
});
