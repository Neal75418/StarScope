/**
 * Unit tests for HealthBadge component
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { HealthBadge } from "../HealthBadge";
import * as apiClient from "../../api/client";

// Mock API client
vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getHealthScoreSummary: vi.fn(),
    getHealthScore: vi.fn(),
    calculateHealthScore: vi.fn(),
  };
});

// Mock i18n with stable references to prevent useEffect re-runs
const mockT = {
  healthScore: {
    failedToLoad: "Failed to load health score",
    calculationFailed: "Calculation failed",
    clickToCalculate: "Click to calculate health score",
  },
  health: {
    titleFormat: "Score: {score}, Grade: {grade}",
  },
};

vi.mock("../../i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../i18n")>();
  return {
    ...actual,
    useI18n: () => ({ t: mockT }),
  };
});

describe("HealthBadge", () => {
  const mockSummary = {
    repo_id: 1,
    overall_score: 85,
    grade: "A",
    calculated_at: "2024-01-10T00:00:00Z",
  };

  const mockFullDetails = {
    ...mockSummary,
    repo_name: "facebook/react",
    issue_response_score: 90,
    pr_merge_score: 85,
    release_cadence_score: 80,
    bus_factor_score: 95,
    documentation_score: 100,
    dependency_score: 75,
    velocity_score: 88,
    commit_activity_score: 82,
    metrics: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    vi.mocked(apiClient.getHealthScoreSummary).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(<HealthBadge repoId={1} />);

    expect(screen.getByText("...")).toBeInTheDocument();
    expect(screen.getByText("...")).toHaveClass("health-badge-loading");
  });

  it("displays health score badge when data is loaded", async () => {
    vi.mocked(apiClient.getHealthScoreSummary).mockResolvedValue(mockSummary);

    render(<HealthBadge repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText("A")).toBeInTheDocument();
    });

    const badge = screen.getByRole("button", { name: /A/i });
    expect(badge).toHaveClass("health-badge");
  });

  it("shows empty state with calculate button when no score exists (404)", async () => {
    vi.mocked(apiClient.getHealthScoreSummary).mockRejectedValue({ status: 404 });

    render(<HealthBadge repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText("?")).toBeInTheDocument();
    });

    const button = screen.getByRole("button", { name: "?" });
    expect(button).toHaveClass("health-badge-empty");
    expect(button).toHaveAttribute("title", "Click to calculate health score");
  });

  it("shows error state when loading fails (non-404 error)", async () => {
    vi.mocked(apiClient.getHealthScoreSummary).mockRejectedValue({
      status: 500,
      detail: "Internal server error",
    });

    render(<HealthBadge repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText("!")).toBeInTheDocument();
    });

    const errorBadge = screen.getByText("!");
    expect(errorBadge).toHaveClass("health-badge-error");
    expect(errorBadge).toHaveAttribute("title", "Failed to load health score");
  });

  it("calculates health score when clicking empty badge", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.getHealthScoreSummary).mockRejectedValue({ status: 404 });
    vi.mocked(apiClient.calculateHealthScore).mockResolvedValue(mockFullDetails);

    render(<HealthBadge repoId={1} />);

    // Wait for initial load to complete (shows "?")
    await waitFor(() => {
      expect(screen.getByText("?")).toBeInTheDocument();
    });

    const calculateButton = screen.getByRole("button", { name: "?" });
    await user.click(calculateButton);

    // Verify calculateHealthScore was called
    expect(apiClient.calculateHealthScore).toHaveBeenCalledWith(1);

    // After calculation completes, should show the grade
    await waitFor(
      () => {
        expect(screen.getByText("A")).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
  });

  it("calls onShowDetails when clicking existing badge", async () => {
    const user = userEvent.setup();
    const mockOnShowDetails = vi.fn();
    vi.mocked(apiClient.getHealthScoreSummary).mockResolvedValue(mockSummary);
    vi.mocked(apiClient.getHealthScore).mockResolvedValue(mockFullDetails);

    render(<HealthBadge repoId={1} onShowDetails={mockOnShowDetails} />);

    await waitFor(() => {
      expect(screen.getByText("A")).toBeInTheDocument();
    });

    const badge = screen.getByRole("button", { name: /A/i });
    await user.click(badge);

    await waitFor(() => {
      expect(apiClient.getHealthScore).toHaveBeenCalledWith(1);
      expect(mockOnShowDetails).toHaveBeenCalledWith(mockFullDetails);
    });
  });

  it("applies correct color for grade A", async () => {
    vi.mocked(apiClient.getHealthScoreSummary).mockResolvedValue({
      ...mockSummary,
      grade: "A",
    });

    render(<HealthBadge repoId={1} />);

    await waitFor(() => {
      const badge = screen.getByRole("button", { name: /A/i });
      expect(badge).toHaveStyle({ backgroundColor: "#166534" });
    });
  });

  it("applies correct color for grade F", async () => {
    vi.mocked(apiClient.getHealthScoreSummary).mockResolvedValue({
      ...mockSummary,
      grade: "F",
      overall_score: 35,
    });

    render(<HealthBadge repoId={1} />);

    await waitFor(() => {
      const badge = screen.getByRole("button", { name: /F/i });
      expect(badge).toHaveStyle({ backgroundColor: "#991b1b" });
    });
  });

  it("shows calculating state when calculate button is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.getHealthScoreSummary).mockRejectedValue({ status: 404 });
    vi.mocked(apiClient.calculateHealthScore).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(mockFullDetails), 500))
    );

    render(<HealthBadge repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText("?")).toBeInTheDocument();
    });

    const calculateButton = screen.getByRole("button", { name: "?" });
    await user.click(calculateButton);

    // Should show calculating state
    await waitFor(() => {
      expect(screen.getByText("...")).toBeInTheDocument();
    });

    // Button should be disabled during calculation
    await waitFor(() => {
      const button = screen.getByRole("button");
      expect(button).toBeDisabled();
    });
  });

  it("cleans up async operations on unmount", async () => {
    vi.mocked(apiClient.getHealthScoreSummary).mockResolvedValue(mockSummary);

    const { unmount } = render(<HealthBadge repoId={1} />);

    // Unmount before API call resolves
    unmount();

    // Should not trigger any state updates (no errors in console)
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
});
