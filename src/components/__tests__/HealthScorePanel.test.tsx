/**
 * Unit tests for HealthScorePanel component
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { HealthScorePanel } from "../HealthScorePanel";
import * as apiClient from "../../api/client";

// Mock API client
vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    calculateHealthScore: vi.fn(),
  };
});

// Mock i18n
vi.mock("../../i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../i18n")>();
  return {
    ...actual,
    useI18n: () => ({
      t: {
        healthScore: {
          title: "Health Score",
          lastCalculated: "Calculated: {date}",
          scoreBreakdown: "Score Breakdown",
          recalculate: "Recalculate",
          calculating: "Calculating...",
          recalculateFailed: "Failed to recalculate",
          close: "Close",
          avgPrefix: "Avg: {time}",
          metrics: {
            issueResponse: "Issue Response",
            prMergeRate: "PR Merge Rate",
            releaseCadence: "Release Cadence",
            busFactor: "Bus Factor",
            documentation: "Documentation",
            dependencies: "Dependencies",
            starVelocity: "Star Velocity",
          },
          time: {
            na: "N/A",
            hours: "{value} hours",
            days: "{value} days",
            weeks: "{value} weeks",
            daysAgo: "{days} days ago",
          },
          format: {
            merged: "{rate}% merged",
            contributors: "{count} contributors",
            none: "None",
          },
        },
      },
    }),
    interpolate: (str: string, vars: Record<string, string | number>) => {
      return str.replace(/{(\w+)}/g, (_, key) => String(vars[key] ?? `{${key}}`));
    },
  };
});

describe("HealthScorePanel", () => {
  const mockDetails = {
    repo_id: 1,
    repo_name: "facebook/react",
    overall_score: 85.5,
    grade: "A",
    issue_response_score: 90,
    pr_merge_score: 85,
    release_cadence_score: 75,
    bus_factor_score: 80,
    documentation_score: 95,
    dependency_score: 70,
    velocity_score: 88,
    calculated_at: "2024-01-15T10:00:00Z",
    metrics: {
      avg_issue_response_hours: 12.5,
      pr_merge_rate: 85,
      days_since_last_release: 14,
      contributor_count: 150,
      has_readme: true,
      has_license: true,
      has_contributing: true,
    },
  };

  const mockOnClose = vi.fn();
  const mockOnRecalculate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders health score panel with title", () => {
    render(<HealthScorePanel details={mockDetails} onClose={mockOnClose} />);

    expect(screen.getByText("Health Score")).toBeInTheDocument();
  });

  it("displays repo name", () => {
    render(<HealthScorePanel details={mockDetails} onClose={mockOnClose} />);

    expect(screen.getByText("facebook/react")).toBeInTheDocument();
  });

  it("displays overall grade", () => {
    render(<HealthScorePanel details={mockDetails} onClose={mockOnClose} />);

    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("displays overall score", () => {
    render(<HealthScorePanel details={mockDetails} onClose={mockOnClose} />);

    expect(screen.getByText("85.5")).toBeInTheDocument();
    expect(screen.getByText("/100")).toBeInTheDocument();
  });

  it("displays all score metrics", () => {
    render(<HealthScorePanel details={mockDetails} onClose={mockOnClose} />);

    expect(screen.getByText("Issue Response")).toBeInTheDocument();
    expect(screen.getByText("PR Merge Rate")).toBeInTheDocument();
    expect(screen.getByText("Release Cadence")).toBeInTheDocument();
    expect(screen.getByText("Bus Factor")).toBeInTheDocument();
    expect(screen.getByText("Documentation")).toBeInTheDocument();
    expect(screen.getByText("Dependencies")).toBeInTheDocument();
    expect(screen.getByText("Star Velocity")).toBeInTheDocument();
  });

  it("calls onClose when close button clicked", async () => {
    const user = userEvent.setup();
    render(<HealthScorePanel details={mockDetails} onClose={mockOnClose} />);

    await user.click(screen.getByText("×"));

    expect(mockOnClose).toHaveBeenCalled();
  });

  it("calls onClose when Close button clicked", async () => {
    const user = userEvent.setup();
    render(<HealthScorePanel details={mockDetails} onClose={mockOnClose} />);

    await user.click(screen.getByText("Close"));

    expect(mockOnClose).toHaveBeenCalled();
  });

  it("calls onClose when overlay clicked", async () => {
    const user = userEvent.setup();
    const { container } = render(<HealthScorePanel details={mockDetails} onClose={mockOnClose} />);

    const overlay = container.querySelector(".health-panel-overlay");
    if (overlay) {
      await user.click(overlay);
    }

    expect(mockOnClose).toHaveBeenCalled();
  });

  it("shows recalculate button", () => {
    render(<HealthScorePanel details={mockDetails} onClose={mockOnClose} />);

    expect(screen.getByText("Recalculate")).toBeInTheDocument();
  });

  it("recalculates score on button click", async () => {
    const user = userEvent.setup();
    const newDetails = { ...mockDetails, overall_score: 90 };
    vi.mocked(apiClient.calculateHealthScore).mockResolvedValue(newDetails);

    render(
      <HealthScorePanel
        details={mockDetails}
        onClose={mockOnClose}
        onRecalculate={mockOnRecalculate}
      />
    );

    await user.click(screen.getByText("Recalculate"));

    await waitFor(() => {
      expect(apiClient.calculateHealthScore).toHaveBeenCalledWith(1);
      expect(mockOnRecalculate).toHaveBeenCalledWith(newDetails);
    });
  });

  it("shows calculating state during recalculation", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.calculateHealthScore).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(<HealthScorePanel details={mockDetails} onClose={mockOnClose} />);

    await user.click(screen.getByText("Recalculate"));

    expect(screen.getByText("Calculating...")).toBeInTheDocument();
  });

  it("shows error on recalculation failure", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.calculateHealthScore).mockRejectedValue(new Error("API error"));

    render(<HealthScorePanel details={mockDetails} onClose={mockOnClose} />);

    await user.click(screen.getByText("Recalculate"));

    await waitFor(() => {
      expect(screen.getByText("Failed to recalculate")).toBeInTheDocument();
    });
  });

  it("displays documentation badges", () => {
    render(<HealthScorePanel details={mockDetails} onClose={mockOnClose} />);

    expect(screen.getByText("README, LICENSE, CONTRIBUTING")).toBeInTheDocument();
  });

  it("displays PR merge rate", () => {
    render(<HealthScorePanel details={mockDetails} onClose={mockOnClose} />);

    expect(screen.getByText("85% merged")).toBeInTheDocument();
  });

  it("displays contributor count", () => {
    render(<HealthScorePanel details={mockDetails} onClose={mockOnClose} />);

    expect(screen.getByText("150 contributors")).toBeInTheDocument();
  });
});
