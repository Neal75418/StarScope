import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CorrelationMatrix, _pearson, _correlationClass } from "../CorrelationMatrix";
import type { ComparisonRepoData, ChartDataPoint } from "../../../api/types";

vi.mock("../../../i18n", () => ({
  useI18n: () => ({
    t: {
      compare: {
        correlation: {
          title: "Correlation Matrix",
        },
      },
    },
  }),
}));

function makeDataPoints(values: number[]): ChartDataPoint[] {
  return values.map((stars, i) => ({
    date: `2024-01-${String(i + 1).padStart(2, "0")}`,
    stars,
    forks: Math.round(stars * 0.1),
    open_issues: 0,
  }));
}

function makeRepo(overrides: Partial<ComparisonRepoData> = {}): ComparisonRepoData {
  return {
    repo_id: 1,
    repo_name: "facebook/react",
    color: "#2563eb",
    data_points: makeDataPoints([100, 110, 120, 130, 140, 150, 160]),
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

describe("_pearson", () => {
  it("returns 1 for identical series", () => {
    expect(_pearson([1, 2, 3, 4], [1, 2, 3, 4])).toBeCloseTo(1);
  });

  it("returns -1 for perfectly negative correlation", () => {
    expect(_pearson([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
  });

  it("returns ~0 for uncorrelated series", () => {
    expect(Math.abs(_pearson([1, 2, 3, 4, 5, 6], [3, 1, 4, 2, 6, 1]))).toBeLessThan(0.5);
  });

  it("returns NaN for constant series", () => {
    expect(_pearson([5, 5, 5], [1, 2, 3])).toBeNaN();
  });

  it("returns NaN for less than 2 points", () => {
    expect(_pearson([1], [1])).toBeNaN();
  });
});

describe("_correlationClass", () => {
  it("returns corr-strong-pos for r >= 0.7", () => {
    expect(_correlationClass(0.8)).toBe("corr-strong-pos");
  });

  it("returns corr-weak-pos for 0.3 <= r < 0.7", () => {
    expect(_correlationClass(0.5)).toBe("corr-weak-pos");
  });

  it("returns corr-neutral for -0.3 < r < 0.3", () => {
    expect(_correlationClass(0.1)).toBe("corr-neutral");
  });

  it("returns corr-weak-neg for -0.7 < r <= -0.3", () => {
    expect(_correlationClass(-0.5)).toBe("corr-weak-neg");
  });

  it("returns corr-strong-neg for r <= -0.7", () => {
    expect(_correlationClass(-0.8)).toBe("corr-strong-neg");
  });

  it("returns corr-na for NaN", () => {
    expect(_correlationClass(NaN)).toBe("corr-na");
  });
});

describe("CorrelationMatrix", () => {
  it("renders nothing with fewer than 2 repos", () => {
    const { container } = render(<CorrelationMatrix repos={[makeRepo()]} metric="stars" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when data_points < 7", () => {
    const repos = [
      makeRepo({ repo_id: 1, data_points: makeDataPoints([100, 110, 120]) }),
      makeRepo({ repo_id: 2, data_points: makeDataPoints([200, 210, 220]), color: "#dc2626" }),
    ];
    const { container } = render(<CorrelationMatrix repos={repos} metric="stars" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders matrix with 2 repos and enough data", () => {
    const repos = [
      makeRepo({ repo_id: 1, repo_name: "facebook/react" }),
      makeRepo({ repo_id: 2, repo_name: "vuejs/vue", color: "#dc2626" }),
    ];
    render(<CorrelationMatrix repos={repos} metric="stars" />);
    expect(screen.getByTestId("correlation-matrix")).toBeInTheDocument();
    expect(screen.getByText("Correlation Matrix")).toBeInTheDocument();
  });

  it("shows short repo names in headers", () => {
    const repos = [
      makeRepo({ repo_id: 1, repo_name: "facebook/react" }),
      makeRepo({ repo_id: 2, repo_name: "vuejs/vue", color: "#dc2626" }),
    ];
    render(<CorrelationMatrix repos={repos} metric="stars" />);
    // Should show "react" and "vue" (split by /)
    expect(screen.getAllByText("react").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("vue").length).toBeGreaterThanOrEqual(1);
  });

  it("shows 1.00 on diagonal cells", () => {
    const repos = [
      makeRepo({
        repo_id: 1,
        repo_name: "facebook/react",
        data_points: makeDataPoints([100, 120, 130, 140, 150, 160, 170]),
      }),
      makeRepo({
        repo_id: 2,
        repo_name: "vuejs/vue",
        color: "#dc2626",
        data_points: makeDataPoints([200, 190, 210, 195, 220, 205, 230]),
      }),
    ];
    render(<CorrelationMatrix repos={repos} metric="stars" />);
    const cells = screen.getAllByText("1.00");
    expect(cells.length).toBe(2); // diagonal only
  });
});
