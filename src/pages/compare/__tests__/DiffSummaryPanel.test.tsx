import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiffSummaryPanel } from "../DiffSummaryPanel";
import type { ComparisonRepoData, ChartDataPoint } from "../../../api/types";

vi.mock("../../../i18n", () => ({
  useI18n: () => ({
    t: {
      compare: {
        perDay: "/day",
        diff: {
          title: "Summary",
          leader: "Leader",
          fastest: "Fastest Growing",
          mostGained: "Most Gained (7d)",
          gap: "Star Gap",
          versus: "vs",
          closing: "Closing",
          widening: "Widening",
        },
      },
    },
  }),
}));

function makeDataPoint(overrides: Partial<ChartDataPoint> = {}): ChartDataPoint {
  return { date: "2024-01-01", stars: 100, forks: 10, open_issues: 0, ...overrides };
}

function makeRepo(overrides: Partial<ComparisonRepoData> = {}): ComparisonRepoData {
  return {
    repo_id: 1,
    repo_name: "facebook/react",
    color: "#2563eb",
    data_points: [makeDataPoint()],
    current_stars: 200000,
    velocity: 14.3,
    acceleration: 0.5,
    trend: 1,
    stars_delta_7d: 100,
    stars_delta_30d: 400,
    issues_delta_7d: null,
    issues_delta_30d: null,
    ...overrides,
  };
}

describe("DiffSummaryPanel", () => {
  it("renders nothing with fewer than 2 repos", () => {
    const { container } = render(<DiffSummaryPanel repos={[makeRepo()]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows correct leader (highest current_stars)", () => {
    const repos = [
      makeRepo({ repo_id: 1, repo_name: "facebook/react", current_stars: 200000 }),
      makeRepo({ repo_id: 2, repo_name: "vuejs/vue", current_stars: 180000, color: "#dc2626" }),
    ];
    render(<DiffSummaryPanel repos={repos} />);
    const cards = screen.getAllByTestId("diff-summary-card");
    // First card = Leader
    expect(cards[0]).toHaveTextContent("Leader");
    expect(cards[0]).toHaveTextContent("facebook/react");
  });

  it("shows correct fastest (highest velocity)", () => {
    const repos = [
      makeRepo({ repo_id: 1, repo_name: "facebook/react", velocity: 14.3 }),
      makeRepo({ repo_id: 2, repo_name: "vuejs/vue", velocity: 20.1, color: "#dc2626" }),
    ];
    render(<DiffSummaryPanel repos={repos} />);
    const cards = screen.getAllByTestId("diff-summary-card");
    // Second card = Fastest Growing
    expect(cards[1]).toHaveTextContent("Fastest Growing");
    expect(cards[1]).toHaveTextContent("vuejs/vue");
  });

  it("shows correct most gained (highest stars_delta_7d)", () => {
    const repos = [
      makeRepo({ repo_id: 1, repo_name: "facebook/react", stars_delta_7d: 100 }),
      makeRepo({ repo_id: 2, repo_name: "vuejs/vue", stars_delta_7d: 300, color: "#dc2626" }),
    ];
    render(<DiffSummaryPanel repos={repos} />);
    const cards = screen.getAllByTestId("diff-summary-card");
    // Third card = Most Gained
    expect(cards[2]).toHaveTextContent("Most Gained (7d)");
    expect(cards[2]).toHaveTextContent("vuejs/vue");
  });

  it("handles null velocity gracefully", () => {
    const repos = [
      makeRepo({ repo_id: 1, velocity: null }),
      makeRepo({ repo_id: 2, velocity: null, color: "#dc2626" }),
    ];
    render(<DiffSummaryPanel repos={repos} />);
    // Should still render leader, most gained, gap, and widening (no fastest)
    const cards = screen.getAllByTestId("diff-summary-card");
    expect(cards.length).toBe(4); // leader + most gained + gap + widening
  });
});

describe("差距那張卡的主詞會換人", () => {
  // 「追趕中」講的是第二名（他在逼近），「拉開中」講的是領先者（他在甩開）。
  // 原本兩種情況都寫死用第二名，於是被甩開的那個被標成「拉開中」——
  // 2026-08-22 實測 Python 26.4/天、metasploit 3.9/天，卡片卻寫
  // 「拉開中 metasploit 22.6/天」，跟事實相反。
  const leader = (velocity: number) =>
    makeRepo({
      repo_id: 1,
      repo_name: "TheAlgorithms/Python",
      current_stars: 223900,
      velocity,
      color: "#dc2626",
    });
  const runner = (velocity: number) =>
    makeRepo({
      repo_id: 2,
      repo_name: "rapid7/metasploit-framework",
      current_stars: 38800,
      velocity,
      color: "#2563eb",
    });

  const cardFor = (label: string) =>
    screen.getAllByTestId("diff-summary-card").find((c) => c.textContent?.startsWith(label));

  it("領先者跑更快時，「拉開中」講的是領先者", () => {
    render(<DiffSummaryPanel repos={[leader(26.4), runner(3.9)]} />);

    const card = cardFor("Widening");
    expect(card).toBeDefined();
    expect(card?.textContent).toContain("TheAlgorithms/Python");
    expect(card?.textContent).not.toContain("rapid7/metasploit-framework");
    expect(card?.textContent).toContain("22.5");
  });

  it("第二名跑更快時，「追趕中」講的是第二名", () => {
    render(<DiffSummaryPanel repos={[leader(3.9), runner(26.4)]} />);

    const card = cardFor("Closing");
    expect(card).toBeDefined();
    expect(card?.textContent).toContain("rapid7/metasploit-framework");
    expect(card?.textContent).not.toContain("TheAlgorithms/Python");
  });

  it("色點跟著主詞換，不是永遠用第二名的顏色", () => {
    render(<DiffSummaryPanel repos={[leader(26.4), runner(3.9)]} />);

    const dot = cardFor("Widening")?.querySelector(".compare-color-dot") as HTMLElement;
    expect(dot.style.background).toBe("rgb(220, 38, 38)"); // 領先者的 #dc2626
  });
});
