import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCrossoverPoints } from "../useCrossoverPoints";

const reposAB = [
  { repo_id: 1, repo_name: "facebook/react" },
  { repo_id: 2, repo_name: "vuejs/vue" },
];

describe("useCrossoverPoints", () => {
  it("returns empty when fewer than 2 repos", () => {
    const { result } = renderHook(() =>
      useCrossoverPoints({
        chartData: [{ date: "2024-01-01", stars_1: 100 }],
        repos: [{ repo_id: 1, repo_name: "facebook/react" }],
        metric: "stars",
      })
    );
    expect(result.current).toEqual([]);
  });

  it("returns empty when more than 3 repos", () => {
    const repos = [
      { repo_id: 1, repo_name: "a" },
      { repo_id: 2, repo_name: "b" },
      { repo_id: 3, repo_name: "c" },
      { repo_id: 4, repo_name: "d" },
    ];
    const { result } = renderHook(() =>
      useCrossoverPoints({
        chartData: [
          { date: "2024-01-01", stars_1: 100, stars_2: 200, stars_3: 50, stars_4: 150 },
          { date: "2024-01-02", stars_1: 250, stars_2: 150, stars_3: 50, stars_4: 150 },
        ],
        repos,
        metric: "stars",
      })
    );
    expect(result.current).toEqual([]);
  });

  it("returns empty when fewer than 2 data points", () => {
    const { result } = renderHook(() =>
      useCrossoverPoints({
        chartData: [{ date: "2024-01-01", stars_1: 100, stars_2: 200 }],
        repos: reposAB,
        metric: "stars",
      })
    );
    expect(result.current).toEqual([]);
  });

  it("detects a crossover when repo A overtakes repo B", () => {
    const chartData = [
      { date: "2024-01-01", stars_1: 100, stars_2: 200 },
      { date: "2024-01-02", stars_1: 250, stars_2: 200 },
    ];
    const { result } = renderHook(() =>
      useCrossoverPoints({ chartData, repos: reposAB, metric: "stars" })
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0].date).toBe("2024-01-02");
    expect(result.current[0].repoA).toBe("facebook/react"); // now leading
    expect(result.current[0].repoB).toBe("vuejs/vue");
  });

  it("detects a crossover when repo B overtakes repo A", () => {
    const chartData = [
      { date: "2024-01-01", stars_1: 300, stars_2: 200 },
      { date: "2024-01-02", stars_1: 180, stars_2: 200 },
    ];
    const { result } = renderHook(() =>
      useCrossoverPoints({ chartData, repos: reposAB, metric: "stars" })
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0].repoA).toBe("vuejs/vue"); // now leading
  });

  it("returns empty when no crossover occurs", () => {
    const chartData = [
      { date: "2024-01-01", stars_1: 100, stars_2: 200 },
      { date: "2024-01-02", stars_1: 120, stars_2: 220 },
      { date: "2024-01-03", stars_1: 140, stars_2: 240 },
    ];
    const { result } = renderHook(() =>
      useCrossoverPoints({ chartData, repos: reposAB, metric: "stars" })
    );
    expect(result.current).toHaveLength(0);
  });

  it("handles multiple crossovers", () => {
    const chartData = [
      { date: "2024-01-01", stars_1: 100, stars_2: 200 },
      { date: "2024-01-02", stars_1: 250, stars_2: 200 }, // crossover 1
      { date: "2024-01-03", stars_1: 180, stars_2: 200 }, // crossover 2
    ];
    const { result } = renderHook(() =>
      useCrossoverPoints({ chartData, repos: reposAB, metric: "stars" })
    );
    expect(result.current).toHaveLength(2);
  });

  it("works with 3 repos (3 pairs)", () => {
    const repos = [
      { repo_id: 1, repo_name: "a" },
      { repo_id: 2, repo_name: "b" },
      { repo_id: 3, repo_name: "c" },
    ];
    const chartData = [
      { date: "2024-01-01", stars_1: 100, stars_2: 200, stars_3: 150 },
      { date: "2024-01-02", stars_1: 250, stars_2: 200, stars_3: 100 }, // 1 overtakes 2, 2 overtakes 3
    ];
    const { result } = renderHook(() => useCrossoverPoints({ chartData, repos, metric: "stars" }));
    // pair (1,2): crossover, pair (1,3): 100<150 → 250>100 = crossover, pair (2,3): 200>150 → 200>100 = no crossover
    expect(result.current).toHaveLength(2);
  });

  it("skips data points with missing values", () => {
    const chartData: { date: string; [key: string]: string | number }[] = [
      { date: "2024-01-01", stars_1: 100, stars_2: 200 },
      { date: "2024-01-02", stars_1: 250 }, // missing stars_2
      { date: "2024-01-03", stars_1: 250, stars_2: 300 },
    ];
    const { result } = renderHook(() =>
      useCrossoverPoints({ chartData, repos: reposAB, metric: "stars" })
    );
    // day 1→2 skipped (missing B at day 2), day 2→3 skipped (missing B at day 2)
    expect(result.current).toHaveLength(0);
  });
});
