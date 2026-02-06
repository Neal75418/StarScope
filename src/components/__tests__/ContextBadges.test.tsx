/**
 * Unit tests for ContextBadges component (HN only after simplification)
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContextBadges } from "../ContextBadges";
import type { ContextBadge } from "../../api/client";

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
});
