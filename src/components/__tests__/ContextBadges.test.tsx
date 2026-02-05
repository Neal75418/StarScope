/**
 * Unit tests for ContextBadges component (HN only after simplification)
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

  const mockHnBadgeNonRecent: ContextBadge = {
    type: "hn",
    label: "HN: 200 pts",
    url: "https://news.ycombinator.com/item?id=456",
    score: 200,
    is_recent: false,
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

  it("renders multiple HN badges", () => {
    render(<ContextBadges badges={[mockHnBadge, mockHnBadgeNonRecent]} />);

    // All links should be present
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
  });

  it("applies recent class to recent badges", () => {
    render(<ContextBadges badges={[mockHnBadge]} />);

    const link = screen.getByRole("link");
    expect(link).toHaveClass("recent");
  });

  it("does not apply recent class to non-recent badges", () => {
    render(<ContextBadges badges={[mockHnBadgeNonRecent]} />);

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
