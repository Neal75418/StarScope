import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { TrendCard } from "../TrendCard";
import type { TrendingRepo } from "../../../api/client";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

const mockNavigateTo = vi.fn();
vi.mock("../../../contexts/NavigationContext", () => ({
  useNavigation: () => ({
    navigateTo: mockNavigateTo,
    navigationState: null,
    consumeNavigationState: () => null,
  }),
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
    description: "A JS library for building UIs",
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
    columns: {
      stars: "Stars",
      velocity: "Stars/Day",
      delta7d: "7d \u0394",
    },
    filters: {
      addToWatchlist: "+ Watchlist",
      inWatchlist: "In Watchlist",
    },
    compareWith: "Compare",
  },
  repo: { trend: "Trend" },
} as ReturnType<typeof import("../../../i18n").useI18n>["t"];

describe("TrendCard", () => {
  it("renders repo name and rank badge", () => {
    render(
      <TrendCard
        repo={makeTrending()}
        isInWatchlist={false}
        isAdding={false}
        onAddToWatchlist={vi.fn()}
        t={mockT}
      />
    );
    expect(screen.getByText("facebook/react")).toBeInTheDocument();
    expect(screen.getByText("#1")).toBeInTheDocument();
  });

  it("applies gold class for rank 1", () => {
    render(
      <TrendCard
        repo={makeTrending({ rank: 1 })}
        isInWatchlist={false}
        isAdding={false}
        onAddToWatchlist={vi.fn()}
        t={mockT}
      />
    );
    const rankEl = screen.getByText("#1");
    expect(rankEl.className).toContain("trend-card-rank-gold");
  });

  it("applies silver class for rank 2", () => {
    render(
      <TrendCard
        repo={makeTrending({ rank: 2 })}
        isInWatchlist={false}
        isAdding={false}
        onAddToWatchlist={vi.fn()}
        t={mockT}
      />
    );
    const rankEl = screen.getByText("#2");
    expect(rankEl.className).toContain("trend-card-rank-silver");
  });

  it("applies bronze class for rank 3", () => {
    render(
      <TrendCard
        repo={makeTrending({ rank: 3 })}
        isInWatchlist={false}
        isAdding={false}
        onAddToWatchlist={vi.fn()}
        t={mockT}
      />
    );
    const rankEl = screen.getByText("#3");
    expect(rankEl.className).toContain("trend-card-rank-bronze");
  });

  it("has no special rank class for rank > 3", () => {
    render(
      <TrendCard
        repo={makeTrending({ rank: 5 })}
        isInWatchlist={false}
        isAdding={false}
        onAddToWatchlist={vi.fn()}
        t={mockT}
      />
    );
    const rankEl = screen.getByText("#5");
    expect(rankEl.className).not.toContain("gold");
    expect(rankEl.className).not.toContain("silver");
    expect(rankEl.className).not.toContain("bronze");
  });

  it("renders description", () => {
    render(
      <TrendCard
        repo={makeTrending({ description: "A cool library" })}
        isInWatchlist={false}
        isAdding={false}
        onAddToWatchlist={vi.fn()}
        t={mockT}
      />
    );
    expect(screen.getByText("A cool library")).toBeInTheDocument();
  });

  it("shows In Watchlist when repo is tracked", () => {
    render(
      <TrendCard
        repo={makeTrending()}
        isInWatchlist={true}
        isAdding={false}
        onAddToWatchlist={vi.fn()}
        t={mockT}
      />
    );
    expect(screen.getByText("In Watchlist")).toBeInTheDocument();
  });

  it("calls onAddToWatchlist when add button is clicked", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(
      <TrendCard
        repo={makeTrending()}
        isInWatchlist={false}
        isAdding={false}
        onAddToWatchlist={onAdd}
        t={mockT}
      />
    );
    await user.click(screen.getByText("+ Watchlist"));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it("renders language badge", () => {
    render(
      <TrendCard
        repo={makeTrending({ language: "Rust" })}
        isInWatchlist={false}
        isAdding={false}
        onAddToWatchlist={vi.fn()}
        t={mockT}
      />
    );
    expect(screen.getByText("Rust")).toBeInTheDocument();
  });

  it("calls navigateTo with preselectedIds when Compare button is clicked", async () => {
    const user = userEvent.setup();
    mockNavigateTo.mockClear();
    render(
      <TrendCard
        repo={makeTrending({ id: 42 })}
        isInWatchlist={false}
        isAdding={false}
        onAddToWatchlist={vi.fn()}
        t={mockT}
      />
    );
    await user.click(screen.getByTestId("trend-compare-btn-42"));
    expect(mockNavigateTo).toHaveBeenCalledWith("compare", { preselectedIds: [42] });
  });
});
