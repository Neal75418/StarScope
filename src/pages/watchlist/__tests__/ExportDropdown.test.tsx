import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExportDropdown } from "../ExportDropdown";

// Mock API client
vi.mock("../../../api/client", () => ({
  getExportWatchlistJsonUrl: () => "http://localhost:9966/api/repos/export?format=json",
  getExportWatchlistCsvUrl: () => "http://localhost:9966/api/repos/export?format=csv",
}));

// Mock i18n
vi.mock("../../../i18n", () => ({
  useI18n: () => ({
    t: {
      watchlist: {
        export: {
          button: "Export",
          json: "Export JSON",
          csv: "Export CSV",
        },
      },
    },
  }),
}));

describe("ExportDropdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders export button", () => {
    render(<ExportDropdown />);
    expect(screen.getByTestId("export-btn")).toBeInTheDocument();
    expect(screen.getByText("Export")).toBeInTheDocument();
  });

  it("opens dropdown on click", () => {
    render(<ExportDropdown />);
    expect(screen.queryByTestId("export-menu")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("export-btn"));
    expect(screen.getByTestId("export-menu")).toBeInTheDocument();
  });

  it("renders JSON and CSV links", () => {
    render(<ExportDropdown />);
    fireEvent.click(screen.getByTestId("export-btn"));

    const jsonLink = screen.getByText("Export JSON");
    const csvLink = screen.getByText("Export CSV");

    expect(jsonLink).toHaveAttribute("href", "http://localhost:9966/api/repos/export?format=json");
    expect(jsonLink).toHaveAttribute("download");
    expect(csvLink).toHaveAttribute("href", "http://localhost:9966/api/repos/export?format=csv");
    expect(csvLink).toHaveAttribute("download");
  });

  it("closes dropdown when clicking a link", () => {
    render(<ExportDropdown />);
    fireEvent.click(screen.getByTestId("export-btn"));

    fireEvent.click(screen.getByText("Export JSON"));
    expect(screen.queryByTestId("export-menu")).not.toBeInTheDocument();
  });

  it("toggles dropdown on repeated button clicks", () => {
    render(<ExportDropdown />);
    const btn = screen.getByTestId("export-btn");

    fireEvent.click(btn);
    expect(screen.getByTestId("export-menu")).toBeInTheDocument();

    fireEvent.click(btn);
    expect(screen.queryByTestId("export-menu")).not.toBeInTheDocument();
  });

  it("sets aria-expanded correctly", () => {
    render(<ExportDropdown />);
    const btn = screen.getByTestId("export-btn");

    expect(btn).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });
});
