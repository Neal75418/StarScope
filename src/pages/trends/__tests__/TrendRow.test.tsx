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

function renderInTable(ui: ReactNode) {
  return render(
    <table>
      <tbody>{ui}</tbody>
    </table>
  );
}

describe("TrendRow", () => {
  it("renders repo name and rank", () => {
    renderInTable(<TrendRow repo={makeTrending()} isExpanded={false} onToggleExpand={vi.fn()} />);
    expect(screen.getByText("facebook/react")).toBeInTheDocument();
    expect(document.querySelector(".rank-badge")).toHaveTextContent("1");
  });

  it("shows collapse chevron when expanded", () => {
    renderInTable(<TrendRow repo={makeTrending()} isExpanded={true} onToggleExpand={vi.fn()} />);
    expect(screen.getByText("\u25be")).toBeInTheDocument(); // ▾
  });

  it("shows expand chevron when collapsed", () => {
    renderInTable(<TrendRow repo={makeTrending()} isExpanded={false} onToggleExpand={vi.fn()} />);
    expect(screen.getByText("\u25b8")).toBeInTheDocument(); // ▸
  });

  it("calls onToggleExpand when row is clicked", async () => {
    const user = userEvent.setup();
    const onToggleExpand = vi.fn();
    renderInTable(
      <TrendRow
        repo={makeTrending({ id: 42 })}
        isExpanded={false}
        onToggleExpand={onToggleExpand}
      />
    );
    await user.click(screen.getByTestId("trend-row-42"));
    expect(onToggleExpand).toHaveBeenCalledWith(42);
  });

  it("renders language badge when language is set", () => {
    renderInTable(
      <TrendRow
        repo={makeTrending({ language: "Rust" })}
        isExpanded={false}
        onToggleExpand={vi.fn()}
      />
    );
    expect(screen.getByText("Rust")).toBeInTheDocument();
  });

  it("has expanded class when isExpanded is true", () => {
    renderInTable(<TrendRow repo={makeTrending()} isExpanded={true} onToggleExpand={vi.fn()} />);
    expect(screen.getByTestId("trend-row-1")).toHaveClass("expanded");
  });
});
