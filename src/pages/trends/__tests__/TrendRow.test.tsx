import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { TrendRow } from "../TrendRow";
import type { TrendingRepo } from "../../../api/client";
import type { ReactNode } from "react";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
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
    description: "A JS library",
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

const mockT = {
  trends: {
    filters: {
      addToWatchlist: "+ Watchlist",
      inWatchlist: "In Watchlist",
    },
  },
  repo: { trend: "Trend" },
} as ReturnType<typeof import("../../../i18n").useI18n>["t"];

function renderInTable(ui: ReactNode) {
  return render(
    <table>
      <tbody>{ui}</tbody>
    </table>
  );
}

describe("TrendRow", () => {
  it("renders repo name and rank", () => {
    renderInTable(
      <TrendRow
        repo={makeTrending()}
        isInWatchlist={false}
        isAdding={false}
        onAddToWatchlist={vi.fn()}
        isExpanded={false}
        onToggleExpand={vi.fn()}
        t={mockT}
      />
    );
    expect(screen.getByText("facebook/react")).toBeInTheDocument();
    expect(document.querySelector(".rank-badge")).toHaveTextContent("1");
  });

  it("shows collapse chevron when expanded", () => {
    renderInTable(
      <TrendRow
        repo={makeTrending()}
        isInWatchlist={false}
        isAdding={false}
        onAddToWatchlist={vi.fn()}
        isExpanded={true}
        onToggleExpand={vi.fn()}
        t={mockT}
      />
    );
    expect(screen.getByText("\u25be")).toBeInTheDocument(); // ▾
  });

  it("shows expand chevron when collapsed", () => {
    renderInTable(
      <TrendRow
        repo={makeTrending()}
        isInWatchlist={false}
        isAdding={false}
        onAddToWatchlist={vi.fn()}
        isExpanded={false}
        onToggleExpand={vi.fn()}
        t={mockT}
      />
    );
    expect(screen.getByText("\u25b8")).toBeInTheDocument(); // ▸
  });

  it("calls onToggleExpand when row is clicked", async () => {
    const user = userEvent.setup();
    const onToggleExpand = vi.fn();
    renderInTable(
      <TrendRow
        repo={makeTrending({ id: 42 })}
        isInWatchlist={false}
        isAdding={false}
        onAddToWatchlist={vi.fn()}
        isExpanded={false}
        onToggleExpand={onToggleExpand}
        t={mockT}
      />
    );
    await user.click(screen.getByTestId("trend-row-42"));
    expect(onToggleExpand).toHaveBeenCalledWith(42);
  });

  it("shows In Watchlist badge when repo is in watchlist", () => {
    renderInTable(
      <TrendRow
        repo={makeTrending()}
        isInWatchlist={true}
        isAdding={false}
        onAddToWatchlist={vi.fn()}
        isExpanded={false}
        onToggleExpand={vi.fn()}
        t={mockT}
      />
    );
    expect(screen.getByText("In Watchlist")).toBeInTheDocument();
  });

  it("calls onAddToWatchlist when add button is clicked without triggering expand", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const onToggle = vi.fn();
    renderInTable(
      <TrendRow
        repo={makeTrending()}
        isInWatchlist={false}
        isAdding={false}
        onAddToWatchlist={onAdd}
        isExpanded={false}
        onToggleExpand={onToggle}
        t={mockT}
      />
    );
    await user.click(screen.getByText("+ Watchlist"));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    // onToggleExpand should also fire since the click bubbles to the row,
    // but the action column's stopPropagation should prevent it
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("renders language badge when language is set", () => {
    renderInTable(
      <TrendRow
        repo={makeTrending({ language: "Rust" })}
        isInWatchlist={false}
        isAdding={false}
        onAddToWatchlist={vi.fn()}
        isExpanded={false}
        onToggleExpand={vi.fn()}
        t={mockT}
      />
    );
    expect(screen.getByText("Rust")).toBeInTheDocument();
  });

  it("has expanded class when isExpanded is true", () => {
    renderInTable(
      <TrendRow
        repo={makeTrending()}
        isInWatchlist={false}
        isAdding={false}
        onAddToWatchlist={vi.fn()}
        isExpanded={true}
        onToggleExpand={vi.fn()}
        t={mockT}
      />
    );
    expect(screen.getByTestId("trend-row-1")).toHaveClass("expanded");
  });
});
