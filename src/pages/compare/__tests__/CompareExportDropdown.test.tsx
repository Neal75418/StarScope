import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { CompareExportDropdown } from "../CompareExportDropdown";

vi.mock("../../../hooks/useClickOutside", () => ({
  useClickOutside: vi.fn(),
}));

vi.mock("../../../api/client", () => ({
  getExportComparisonJsonUrl: (repoIds: number[], timeRange: string, normalize: boolean) => {
    const params = new URLSearchParams({
      repo_ids: repoIds.join(","),
      time_range: timeRange,
      normalize: String(normalize),
    });
    return `/api/export/comparison.json?${params}`;
  },
  getExportComparisonCsvUrl: (repoIds: number[], timeRange: string, normalize: boolean) => {
    const params = new URLSearchParams({
      repo_ids: repoIds.join(","),
      time_range: timeRange,
      normalize: String(normalize),
    });
    return `/api/export/comparison.csv?${params}`;
  },
}));

describe("CompareExportDropdown", () => {
  it("renders export button", () => {
    render(<CompareExportDropdown repoIds={[1, 2]} timeRange="30d" normalize={false} />);
    expect(screen.getByTestId("compare-export-btn")).toBeInTheDocument();
  });

  it("does not show menu initially", () => {
    render(<CompareExportDropdown repoIds={[1, 2]} timeRange="30d" normalize={false} />);
    expect(screen.queryByTestId("compare-export-menu")).not.toBeInTheDocument();
  });

  it("shows menu when button is clicked", async () => {
    const user = userEvent.setup();
    render(<CompareExportDropdown repoIds={[1, 2]} timeRange="30d" normalize={false} />);
    await user.click(screen.getByTestId("compare-export-btn"));
    expect(screen.getByTestId("compare-export-menu")).toBeInTheDocument();
  });

  it("renders JSON and CSV links with correct hrefs", async () => {
    const user = userEvent.setup();
    render(<CompareExportDropdown repoIds={[1, 2]} timeRange="30d" normalize={true} />);
    await user.click(screen.getByTestId("compare-export-btn"));

    const jsonLink = screen.getByText("Download JSON");
    const csvLink = screen.getByText("Download CSV");

    expect(jsonLink).toHaveAttribute(
      "href",
      "/api/export/comparison.json?repo_ids=1%2C2&time_range=30d&normalize=true"
    );
    expect(csvLink).toHaveAttribute(
      "href",
      "/api/export/comparison.csv?repo_ids=1%2C2&time_range=30d&normalize=true"
    );
  });

  it("closes menu when JSON link is clicked", async () => {
    const user = userEvent.setup();
    render(<CompareExportDropdown repoIds={[1, 2]} timeRange="30d" normalize={false} />);
    await user.click(screen.getByTestId("compare-export-btn"));
    expect(screen.getByTestId("compare-export-menu")).toBeInTheDocument();

    await user.click(screen.getByText("Download JSON"));
    expect(screen.queryByTestId("compare-export-menu")).not.toBeInTheDocument();
  });

  it("toggles menu on repeated clicks", async () => {
    const user = userEvent.setup();
    render(<CompareExportDropdown repoIds={[1, 2]} timeRange="30d" normalize={false} />);

    await user.click(screen.getByTestId("compare-export-btn"));
    expect(screen.getByTestId("compare-export-menu")).toBeInTheDocument();

    await user.click(screen.getByTestId("compare-export-btn"));
    expect(screen.queryByTestId("compare-export-menu")).not.toBeInTheDocument();
  });
});
