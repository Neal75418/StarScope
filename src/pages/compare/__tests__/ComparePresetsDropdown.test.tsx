import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ComparePresetsDropdown } from "../ComparePresetsDropdown";
import { STORAGE_KEYS } from "../../../constants/storage";

vi.mock("../../../i18n", () => ({
  useI18n: () => ({
    t: {
      compare: {
        presets: {
          title: "Presets",
          saveCurrent: "Save Current",
          namePlaceholder: "Preset name...",
          empty: "No saved presets",
          delete: "Delete",
        },
      },
    },
  }),
}));

const defaultProps = {
  repoIds: [1, 2],
  timeRange: "30d" as const,
  normalize: false,
  metric: "stars" as const,
  chartType: "line" as const,
  logScale: false,
  showGrowthRate: false,
  onApply: vi.fn(),
};

describe("ComparePresetsDropdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem(STORAGE_KEYS.COMPARE_PRESETS);
  });

  it("renders the presets button", () => {
    render(<ComparePresetsDropdown {...defaultProps} />);
    expect(screen.getByTestId("compare-presets-btn")).toHaveTextContent("Presets");
  });

  it("opens menu on click", async () => {
    render(<ComparePresetsDropdown {...defaultProps} />);
    await userEvent.click(screen.getByTestId("compare-presets-btn"));
    expect(screen.getByTestId("compare-presets-menu")).toBeInTheDocument();
    expect(screen.getByText("No saved presets")).toBeInTheDocument();
  });

  it("saves a preset via the save button", async () => {
    render(<ComparePresetsDropdown {...defaultProps} />);
    await userEvent.click(screen.getByTestId("compare-presets-btn"));
    await userEvent.type(screen.getByTestId("compare-presets-name-input"), "My Preset");
    await userEvent.click(screen.getByTestId("compare-presets-save-btn"));
    // The preset should now appear in the list
    expect(screen.getByText("My Preset")).toBeInTheDocument();
    expect(screen.queryByText("No saved presets")).not.toBeInTheDocument();
  });

  it("applies a preset on click", async () => {
    // Pre-populate a preset
    const existing = [
      {
        id: "preset_test",
        name: "Existing",
        createdAt: "2024-01-01T00:00:00Z",
        repoIds: [3, 4],
        timeRange: "7d",
        normalize: true,
        metric: "forks",
        chartType: "area",
        logScale: true,
        showGrowthRate: false,
      },
    ];
    localStorage.setItem(STORAGE_KEYS.COMPARE_PRESETS, JSON.stringify(existing));

    render(<ComparePresetsDropdown {...defaultProps} />);
    await userEvent.click(screen.getByTestId("compare-presets-btn"));
    await userEvent.click(screen.getByText("Existing"));
    expect(defaultProps.onApply).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Existing", repoIds: [3, 4] })
    );
  });

  it("deletes a preset", async () => {
    const existing = [
      {
        id: "preset_del",
        name: "ToDelete",
        createdAt: "2024-01-01T00:00:00Z",
        repoIds: [1],
        timeRange: "30d",
        normalize: false,
        metric: "stars",
        chartType: "line",
        logScale: false,
        showGrowthRate: false,
      },
    ];
    localStorage.setItem(STORAGE_KEYS.COMPARE_PRESETS, JSON.stringify(existing));

    render(<ComparePresetsDropdown {...defaultProps} />);
    await userEvent.click(screen.getByTestId("compare-presets-btn"));
    expect(screen.getByText("ToDelete")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("compare-preset-delete-preset_del"));
    expect(screen.queryByText("ToDelete")).not.toBeInTheDocument();
    expect(screen.getByText("No saved presets")).toBeInTheDocument();
  });
});
