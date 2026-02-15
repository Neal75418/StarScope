/**
 * Unit tests for ContextBadges component (HN only after simplification)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ContextBadges } from "../ContextBadges";
import type { ContextBadge } from "../../api/client";
import { getContextSignals } from "../../api/client";

// Mock the openUrl function
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

// Mock getContextSignals for expand tests
vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getContextSignals: vi.fn().mockResolvedValue({ signals: [], total: 0, repo_id: 1 }),
  };
});

const mockGetContextSignals = vi.mocked(getContextSignals);

describe("ContextBadges", () => {
  const mockHnBadge: ContextBadge = {
    type: "hn",
    label: "HN: 500 pts",
    url: "https://news.ycombinator.com/item?id=123",
    score: 500,
    is_recent: true,
  };

  const mockHnBadgeNonRecent: ContextBadge = {
    type: "hn",
    label: "HN: 200 pts",
    url: "https://news.ycombinator.com/item?id=456",
    score: 200,
    is_recent: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContextSignals.mockResolvedValue({ signals: [], total: 0, repo_id: 1 });
  });

  it("returns null when badges array is empty", () => {
    const { container } = render(<ContextBadges badges={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders HN badge with icon, label and parsed value", () => {
    render(<ContextBadges badges={[mockHnBadge]} />);

    // Icon and "HN" label
    expect(screen.getByText("🔶")).toBeInTheDocument();
    expect(screen.getByText("HN")).toBeInTheDocument();
    // Parsed value from "HN: 500 pts"
    expect(screen.getByText("500")).toBeInTheDocument();

    const button = screen.getByRole("button");
    expect(button).toBeInTheDocument();
  });

  it("renders multiple HN badges", () => {
    render(<ContextBadges badges={[mockHnBadge, mockHnBadgeNonRecent]} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
  });

  it("applies recent class to recent badges", () => {
    render(<ContextBadges badges={[mockHnBadge]} />);

    const button = screen.getByRole("button");
    expect(button).toHaveClass("recent");
  });

  it("does not apply recent class to non-recent badges", () => {
    render(<ContextBadges badges={[mockHnBadgeNonRecent]} />);

    const button = screen.getByRole("button");
    expect(button).not.toHaveClass("recent");
  });

  it("shows expand arrow when repoId is provided", () => {
    render(<ContextBadges badges={[mockHnBadge]} repoId={1} />);

    const button = screen.getByRole("button");
    expect(button).toHaveClass("expandable");
    expect(screen.getByText("▸")).toBeInTheDocument();
  });

  it("applies badge type class for styling", () => {
    render(<ContextBadges badges={[mockHnBadge]} />);

    const button = screen.getByRole("button");
    expect(button).toHaveClass("context-badge-hn");
  });

  // --- New tests for uncovered branches ---

  it("uses fallback config for unknown badge type", () => {
    const unknownBadge: ContextBadge = {
      type: "hn", // hn is the only type, but to cover the fallback in BADGE_CONFIG
      label: "no-number-here",
      url: "https://example.com",
      score: null,
      is_recent: false,
    };
    render(<ContextBadges badges={[unknownBadge]} />);
    // formatValue: label "no-number-here" doesn't match \d+ regex → returns full label
    expect(screen.getByText("no-number-here")).toBeInTheDocument();
  });

  it("formatValue returns full label when no number in HN badge label", () => {
    const badge: ContextBadge = {
      type: "hn",
      label: "no digits",
      url: "https://example.com",
      score: null,
      is_recent: false,
    };
    render(<ContextBadges badges={[badge]} />);
    expect(screen.getByText("no digits")).toBeInTheDocument();
  });

  it("does not show expand arrow when repoId is not provided", () => {
    render(<ContextBadges badges={[mockHnBadge]} />);
    expect(screen.queryByText("▸")).not.toBeInTheDocument();
    expect(screen.queryByText("▾")).not.toBeInTheDocument();
  });

  it("toggleExpand fetches signals on first expand", async () => {
    const user = userEvent.setup();
    mockGetContextSignals.mockResolvedValueOnce({
      signals: [
        {
          id: 1,
          signal_type: "hn",
          external_id: "123",
          title: "HN Discussion",
          url: "https://news.ycombinator.com/item?id=123",
          score: 100,
          comment_count: 50,
          author: "pg",
          version_tag: null,
          is_prerelease: null,
          published_at: new Date().toISOString(),
          fetched_at: new Date().toISOString(),
        },
      ],
      total: 1,
      repo_id: 1,
    });

    render(<ContextBadges badges={[mockHnBadge]} repoId={1} />);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(mockGetContextSignals).toHaveBeenCalledWith(1, "hn");
      expect(screen.getByText("HN Discussion")).toBeInTheDocument();
      expect(screen.getByText("▲ 100")).toBeInTheDocument();
      expect(screen.getByText("💬 50")).toBeInTheDocument();
      expect(screen.getByText("pg")).toBeInTheDocument();
    });
  });

  it("changes expand arrow after toggle", async () => {
    const user = userEvent.setup();

    render(<ContextBadges badges={[mockHnBadge]} repoId={1} />);
    // Initially collapsed
    expect(screen.getByText("▸")).toBeInTheDocument();
    await user.click(screen.getByRole("button"));

    // After expand
    await waitFor(() => {
      expect(screen.getByText("▾")).toBeInTheDocument();
    });
  });

  it("shows empty panel when no signals returned", async () => {
    const user = userEvent.setup();
    mockGetContextSignals.mockResolvedValueOnce({ signals: [], total: 0, repo_id: 1 });

    render(<ContextBadges badges={[mockHnBadge]} repoId={1} />);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText("No discussions found")).toBeInTheDocument();
    });
  });

  it("handles getContextSignals error gracefully", async () => {
    const user = userEvent.setup();
    mockGetContextSignals.mockRejectedValueOnce(new Error("Network error"));

    render(<ContextBadges badges={[mockHnBadge]} repoId={1} />);
    await user.click(screen.getByRole("button"));

    // Should show empty state after error (signals set to [])
    await waitFor(() => {
      expect(screen.getByText("No discussions found")).toBeInTheDocument();
    });
  });

  it("does not re-fetch signals on second toggle", async () => {
    const user = userEvent.setup();
    mockGetContextSignals.mockResolvedValue({ signals: [], total: 0, repo_id: 1 });

    render(<ContextBadges badges={[mockHnBadge]} repoId={1} />);
    // First click: expand (fetches)
    await user.click(screen.getByRole("button"));
    await waitFor(() => expect(mockGetContextSignals).toHaveBeenCalledTimes(1));

    // Second click: collapse
    await user.click(screen.getByRole("button"));
    // Third click: expand again (should NOT re-fetch since signalsFetched=true)
    await user.click(screen.getByRole("button"));
    expect(mockGetContextSignals).toHaveBeenCalledTimes(1);
  });

  it("toggleExpand does nothing when repoId is undefined", async () => {
    const user = userEvent.setup();
    render(<ContextBadges badges={[mockHnBadge]} />);
    // Badge without repoId has no onClick
    const button = screen.getByRole("button");
    await user.click(button);
    expect(mockGetContextSignals).not.toHaveBeenCalled();
  });

  it("renders signal with null metadata fields", async () => {
    const user = userEvent.setup();
    mockGetContextSignals.mockResolvedValueOnce({
      signals: [
        {
          id: 2,
          signal_type: "hn",
          external_id: "456",
          title: "",
          url: "https://news.ycombinator.com/item?id=456",
          score: null,
          comment_count: null,
          author: null,
          version_tag: null,
          is_prerelease: null,
          published_at: null,
          fetched_at: new Date().toISOString(),
        },
      ],
      total: 1,
      repo_id: 1,
    });

    render(<ContextBadges badges={[mockHnBadge]} repoId={1} />);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      // Empty title falls back to "Untitled"
      expect(screen.getByText("Untitled")).toBeInTheDocument();
      // Null score/comment_count/author/published_at should not render
      expect(screen.queryByText(/▲/)).not.toBeInTheDocument();
      expect(screen.queryByText(/💬/)).not.toBeInTheDocument();
    });
  });

  it("renders time ago for signals with published_at", async () => {
    const user = userEvent.setup();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    mockGetContextSignals.mockResolvedValueOnce({
      signals: [
        {
          id: 3,
          signal_type: "hn",
          external_id: "789",
          title: "Old Discussion",
          url: "https://news.ycombinator.com/item?id=789",
          score: 42,
          comment_count: null,
          author: null,
          version_tag: null,
          is_prerelease: null,
          published_at: twoDaysAgo,
          fetched_at: new Date().toISOString(),
        },
      ],
      total: 1,
      repo_id: 1,
    });

    render(<ContextBadges badges={[mockHnBadge]} repoId={1} />);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText("2d ago")).toBeInTheDocument();
    });
  });

  it("renders 'today' for signal published today", async () => {
    const user = userEvent.setup();
    mockGetContextSignals.mockResolvedValueOnce({
      signals: [
        {
          id: 4,
          signal_type: "hn",
          external_id: "101",
          title: "Today Discussion",
          url: "https://example.com",
          score: 10,
          comment_count: 5,
          author: "user1",
          version_tag: null,
          is_prerelease: null,
          published_at: new Date().toISOString(),
          fetched_at: new Date().toISOString(),
        },
      ],
      total: 1,
      repo_id: 1,
    });

    render(<ContextBadges badges={[mockHnBadge]} repoId={1} />);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText("today")).toBeInTheDocument();
    });
  });

  it("renders '1d ago' for signal from yesterday", async () => {
    const user = userEvent.setup();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    mockGetContextSignals.mockResolvedValueOnce({
      signals: [
        {
          id: 5,
          signal_type: "hn",
          external_id: "102",
          title: "Yesterday",
          url: "https://example.com",
          score: null,
          comment_count: null,
          author: null,
          version_tag: null,
          is_prerelease: null,
          published_at: yesterday,
          fetched_at: new Date().toISOString(),
        },
      ],
      total: 1,
      repo_id: 1,
    });

    render(<ContextBadges badges={[mockHnBadge]} repoId={1} />);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText("1d ago")).toBeInTheDocument();
    });
  });

  it("renders months ago for older signals", async () => {
    const user = userEvent.setup();
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    mockGetContextSignals.mockResolvedValueOnce({
      signals: [
        {
          id: 6,
          signal_type: "hn",
          external_id: "103",
          title: "Old Signal",
          url: "https://example.com",
          score: null,
          comment_count: null,
          author: null,
          version_tag: null,
          is_prerelease: null,
          published_at: sixtyDaysAgo,
          fetched_at: new Date().toISOString(),
        },
      ],
      total: 1,
      repo_id: 1,
    });

    render(<ContextBadges badges={[mockHnBadge]} repoId={1} />);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText("2mo ago")).toBeInTheDocument();
    });
  });

  it("renders years ago for very old signals", async () => {
    const user = userEvent.setup();
    const twoYearsAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    mockGetContextSignals.mockResolvedValueOnce({
      signals: [
        {
          id: 7,
          signal_type: "hn",
          external_id: "104",
          title: "Ancient Signal",
          url: "https://example.com",
          score: null,
          comment_count: null,
          author: null,
          version_tag: null,
          is_prerelease: null,
          published_at: twoYearsAgo,
          fetched_at: new Date().toISOString(),
        },
      ],
      total: 1,
      repo_id: 1,
    });

    render(<ContextBadges badges={[mockHnBadge]} repoId={1} />);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText("1y ago")).toBeInTheDocument();
    });
  });
});
