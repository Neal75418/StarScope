/**
 * Unit tests for ContextBadges component
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ContextBadges } from "../ContextBadges";
import type { ContextBadge } from "../../api/client";
import { openUrl } from "@tauri-apps/plugin-opener";

// Mock the openUrl function
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

describe("ContextBadges", () => {
  const mockHnBadge: ContextBadge = {
    type: "hn",
    label: "HN: 500 pts",
    url: "https://news.ycombinator.com/item?id=123",
    score: 500,
    is_recent: true,
  };

  const mockRedditBadge: ContextBadge = {
    type: "reddit",
    label: "Reddit: 1250",
    url: "https://reddit.com/r/programming/123",
    score: 1250,
    is_recent: false,
  };

  const mockReleaseBadge: ContextBadge = {
    type: "release",
    label: "Release v2.0.0",
    url: "https://github.com/facebook/react/releases/tag/v2.0.0",
    score: null,
    is_recent: true,
  };

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

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://news.ycombinator.com/item?id=123");
  });

  it("renders Reddit badge with icon, label and formatted value", () => {
    render(<ContextBadges badges={[mockRedditBadge]} />);

    // Icon and "Reddit" label
    expect(screen.getByText("💬")).toBeInTheDocument();
    expect(screen.getByText("Reddit")).toBeInTheDocument();
    // Parsed and formatted value from "Reddit: 1250" -> "1.3k"
    expect(screen.getByText("1.3k")).toBeInTheDocument();

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://reddit.com/r/programming/123");
  });

  it("renders Release badge with icon and version", () => {
    render(<ContextBadges badges={[mockReleaseBadge]} />);

    // Icon (no label for release)
    expect(screen.getByText("🏷️")).toBeInTheDocument();
    // Parsed version from "Release v2.0.0"
    expect(screen.getByText("v2.0.0")).toBeInTheDocument();

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://github.com/facebook/react/releases/tag/v2.0.0");
  });

  it("renders multiple badges", () => {
    render(<ContextBadges badges={[mockHnBadge, mockRedditBadge, mockReleaseBadge]} />);

    // All icons should be present
    expect(screen.getByText("🔶")).toBeInTheDocument();
    expect(screen.getByText("💬")).toBeInTheDocument();
    expect(screen.getByText("🏷️")).toBeInTheDocument();

    // All links should be present
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
  });

  it("applies recent class to recent badges", () => {
    render(<ContextBadges badges={[mockHnBadge]} />);

    const link = screen.getByRole("link");
    expect(link).toHaveClass("recent");
  });

  it("does not apply recent class to non-recent badges", () => {
    render(<ContextBadges badges={[mockRedditBadge]} />);

    const link = screen.getByRole("link");
    expect(link).not.toHaveClass("recent");
  });

  it("opens links in browser using openUrl", () => {
    render(<ContextBadges badges={[mockHnBadge]} />);

    const link = screen.getByRole("link");
    expect(link).toBeInTheDocument();

    // Verify it doesn't have target="_blank" anymore
    expect(link).not.toHaveAttribute("target");

    // Click the link
    fireEvent.click(link);

    // Verify openUrl was called with the correct URL
    expect(openUrl).toHaveBeenCalledWith(mockHnBadge.url);
  });

  it("applies badge type class for styling", () => {
    render(<ContextBadges badges={[mockHnBadge]} />);

    const link = screen.getByRole("link");
    expect(link).toHaveClass("context-badge-hn");
  });
});
