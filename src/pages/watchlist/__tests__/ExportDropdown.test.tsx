import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ExportDropdown } from "../ExportDropdown";
import { saveExport } from "../../../utils/saveFile";

vi.mock("../../../utils/saveFile", () => ({ saveExport: vi.fn() }));

// Mock API client
// 只換網址：ApiError 等其他 export 要是真的，getErrorMessage 會用到
vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getExportWatchlistJsonUrl: () => "http://localhost:9966/api/repos/export?format=json",
  getExportWatchlistCsvUrl: () => "http://localhost:9966/api/repos/export?format=csv",
}));

// Mock i18n
vi.mock("../../../i18n", () => ({
  useI18n: () => ({
    t: {
      common: { error: "Error" },
      watchlist: {
        export: {
          button: "Export",
          json: "Export JSON",
          csv: "Export CSV",
          saved: "Exported",
          failed: "Export failed: {error}",
        },
      },
    },
  }),
}));

const onSaved = vi.fn();
const onFailed = vi.fn();
const renderDropdown = () => render(<ExportDropdown onSaved={onSaved} onFailed={onFailed} />);

describe("ExportDropdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(saveExport).mockResolvedValue("saved");
  });

  it("renders export button", () => {
    renderDropdown();
    expect(screen.getByTestId("export-btn")).toBeInTheDocument();
    expect(screen.getByText("Export")).toBeInTheDocument();
  });

  it("opens dropdown on click", () => {
    renderDropdown();
    expect(screen.queryByTestId("export-menu")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("export-btn"));
    expect(screen.getByTestId("export-menu")).toBeInTheDocument();
  });

  it("匯出經由 saveExport 取得內容並存檔，不再是 <a href download>", async () => {
    // <a href download> 是頁面導覽：不帶 X-Session-Secret，正式版的 sidecar 一律 403
    renderDropdown();
    fireEvent.click(screen.getByTestId("export-btn"));

    expect(screen.getByText("Export JSON").closest("a")).toBeNull();
    fireEvent.click(screen.getByText("Export JSON"));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("Exported"));
    expect(saveExport).toHaveBeenCalledWith(
      "http://localhost:9966/api/repos/export?format=json",
      "starscope_watchlist.json"
    );
  });

  it("CSV 用 CSV 的網址與預設檔名", async () => {
    renderDropdown();
    fireEvent.click(screen.getByTestId("export-btn"));
    fireEvent.click(screen.getByText("Export CSV"));

    await waitFor(() =>
      expect(saveExport).toHaveBeenCalledWith(
        "http://localhost:9966/api/repos/export?format=csv",
        "starscope_watchlist.csv"
      )
    );
  });

  it("使用者取消存檔時不回報成功也不回報失敗", async () => {
    vi.mocked(saveExport).mockResolvedValue("cancelled");
    renderDropdown();
    fireEvent.click(screen.getByTestId("export-btn"));
    fireEvent.click(screen.getByText("Export JSON"));

    await waitFor(() => expect(saveExport).toHaveBeenCalled());
    await Promise.resolve();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("失敗時帶著原因回報，而不是無聲吞掉", async () => {
    vi.mocked(saveExport).mockRejectedValue(new Error("Forbidden"));
    renderDropdown();
    fireEvent.click(screen.getByTestId("export-btn"));
    fireEvent.click(screen.getByText("Export JSON"));

    await waitFor(() => expect(onFailed).toHaveBeenCalledWith("Export failed: Forbidden"));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("closes dropdown when clicking a link", () => {
    renderDropdown();
    fireEvent.click(screen.getByTestId("export-btn"));

    fireEvent.click(screen.getByText("Export JSON"));
    expect(screen.queryByTestId("export-menu")).not.toBeInTheDocument();
  });

  it("toggles dropdown on repeated button clicks", () => {
    renderDropdown();
    const btn = screen.getByTestId("export-btn");

    fireEvent.click(btn);
    expect(screen.getByTestId("export-menu")).toBeInTheDocument();

    fireEvent.click(btn);
    expect(screen.queryByTestId("export-menu")).not.toBeInTheDocument();
  });

  it("sets aria-expanded correctly", () => {
    renderDropdown();
    const btn = screen.getByTestId("export-btn");

    expect(btn).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });
});
