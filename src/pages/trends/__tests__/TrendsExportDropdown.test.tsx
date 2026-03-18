import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { TrendsExportDropdown } from "../TrendsExportDropdown";

vi.mock("../../../hooks/useClickOutside", () => ({
  useClickOutside: vi.fn(),
}));

vi.mock("../../../api/client", () => ({
  getExportTrendsJsonUrl: (sortBy: string, lang?: string, stars?: number) => {
    let url = `/api/export/trends.json?sort_by=${sortBy}`;
    if (lang) url += `&language=${lang}`;
    if (stars !== undefined) url += `&min_stars=${stars}`;
    return url;
  },
  getExportTrendsCsvUrl: (sortBy: string, lang?: string, stars?: number) => {
    let url = `/api/export/trends.csv?sort_by=${sortBy}`;
    if (lang) url += `&language=${lang}`;
    if (stars !== undefined) url += `&min_stars=${stars}`;
    return url;
  },
}));

describe("TrendsExportDropdown", () => {
  it("renders export button", () => {
    render(<TrendsExportDropdown sortBy="velocity" language="" minStars={null} />);
    expect(screen.getByTestId("trends-export-btn")).toBeInTheDocument();
  });

  it("does not show menu initially", () => {
    render(<TrendsExportDropdown sortBy="velocity" language="" minStars={null} />);
    expect(screen.queryByTestId("trends-export-menu")).not.toBeInTheDocument();
  });

  it("shows menu when button is clicked", async () => {
    const user = userEvent.setup();
    render(<TrendsExportDropdown sortBy="velocity" language="" minStars={null} />);
    await user.click(screen.getByTestId("trends-export-btn"));
    expect(screen.getByTestId("trends-export-menu")).toBeInTheDocument();
  });

  it("renders JSON and CSV links with correct hrefs", async () => {
    const user = userEvent.setup();
    render(<TrendsExportDropdown sortBy="velocity" language="Python" minStars={1000} />);
    await user.click(screen.getByTestId("trends-export-btn"));

    const jsonLink = screen.getByText("Export JSON");
    const csvLink = screen.getByText("Export CSV");

    expect(jsonLink).toHaveAttribute(
      "href",
      "/api/export/trends.json?sort_by=velocity&language=Python&min_stars=1000"
    );
    expect(csvLink).toHaveAttribute(
      "href",
      "/api/export/trends.csv?sort_by=velocity&language=Python&min_stars=1000"
    );
  });

  it("omits language and min_stars when not set", async () => {
    const user = userEvent.setup();
    render(<TrendsExportDropdown sortBy="stars_delta_7d" language="" minStars={null} />);
    await user.click(screen.getByTestId("trends-export-btn"));

    const jsonLink = screen.getByText("Export JSON");
    expect(jsonLink).toHaveAttribute("href", "/api/export/trends.json?sort_by=stars_delta_7d");
  });

  it("closes menu when JSON link is clicked", async () => {
    const user = userEvent.setup();
    render(<TrendsExportDropdown sortBy="velocity" language="" minStars={null} />);
    await user.click(screen.getByTestId("trends-export-btn"));
    expect(screen.getByTestId("trends-export-menu")).toBeInTheDocument();

    await user.click(screen.getByText("Export JSON"));
    expect(screen.queryByTestId("trends-export-menu")).not.toBeInTheDocument();
  });

  it("toggles menu on repeated clicks", async () => {
    const user = userEvent.setup();
    render(<TrendsExportDropdown sortBy="velocity" language="" minStars={null} />);

    await user.click(screen.getByTestId("trends-export-btn"));
    expect(screen.getByTestId("trends-export-menu")).toBeInTheDocument();

    await user.click(screen.getByTestId("trends-export-btn"));
    expect(screen.queryByTestId("trends-export-menu")).not.toBeInTheDocument();
  });
});
