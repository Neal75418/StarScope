import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { TrendsExportDropdown } from "../TrendsExportDropdown";
import { saveExport } from "../../../utils/saveFile";

vi.mock("../../../utils/saveFile", () => ({ saveExport: vi.fn() }));

const onSaved = vi.fn();
const onFailed = vi.fn();

vi.mock("../../../hooks/useClickOutside", () => ({
  useClickOutside: vi.fn(),
}));

// 只換網址：ApiError 等其他 export 要是真的，getErrorMessage 會用到
vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(saveExport).mockResolvedValue("saved");
  });

  it("renders export button", () => {
    render(
      <TrendsExportDropdown
        sortBy="velocity"
        language=""
        minStars={null}
        onSaved={onSaved}
        onFailed={onFailed}
      />
    );
    expect(screen.getByTestId("trends-export-btn")).toBeInTheDocument();
  });

  it("does not show menu initially", () => {
    render(
      <TrendsExportDropdown
        sortBy="velocity"
        language=""
        minStars={null}
        onSaved={onSaved}
        onFailed={onFailed}
      />
    );
    expect(screen.queryByTestId("trends-export-menu")).not.toBeInTheDocument();
  });

  it("shows menu when button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <TrendsExportDropdown
        sortBy="velocity"
        language=""
        minStars={null}
        onSaved={onSaved}
        onFailed={onFailed}
      />
    );
    await user.click(screen.getByTestId("trends-export-btn"));
    expect(screen.getByTestId("trends-export-menu")).toBeInTheDocument();
  });

  it("匯出帶著目前的篩選條件經由 saveExport 存檔", async () => {
    vi.mocked(saveExport).mockResolvedValue("saved");
    const user = userEvent.setup();
    render(
      <TrendsExportDropdown
        sortBy="velocity"
        language="Python"
        minStars={1000}
        onSaved={onSaved}
        onFailed={onFailed}
      />
    );
    await user.click(screen.getByTestId("trends-export-btn"));

    expect(screen.getByText("Export JSON").closest("a")).toBeNull();
    await user.click(screen.getByText("Export JSON"));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(saveExport).toHaveBeenCalledWith(
      "/api/export/trends.json?sort_by=velocity&language=Python&min_stars=1000",
      "starscope_trends.json"
    );
  });

  it("CSV 用 CSV 的網址，沒設的篩選條件不帶", async () => {
    vi.mocked(saveExport).mockResolvedValue("saved");
    const user = userEvent.setup();
    render(
      <TrendsExportDropdown
        sortBy="stars_delta_7d"
        language=""
        minStars={null}
        onSaved={onSaved}
        onFailed={onFailed}
      />
    );
    await user.click(screen.getByTestId("trends-export-btn"));
    await user.click(screen.getByText("Export CSV"));

    await waitFor(() =>
      expect(saveExport).toHaveBeenCalledWith(
        "/api/export/trends.csv?sort_by=stars_delta_7d",
        "starscope_trends.csv"
      )
    );
  });

  it("使用者取消存檔時不回報成功也不回報失敗", async () => {
    vi.mocked(saveExport).mockResolvedValue("cancelled");
    const user = userEvent.setup();
    render(
      <TrendsExportDropdown
        sortBy="velocity"
        language=""
        minStars={null}
        onSaved={onSaved}
        onFailed={onFailed}
      />
    );
    await user.click(screen.getByTestId("trends-export-btn"));
    await user.click(screen.getByText("Export JSON"));

    await waitFor(() => expect(saveExport).toHaveBeenCalled());
    expect(onSaved).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("失敗時帶著原因回報", async () => {
    vi.mocked(saveExport).mockRejectedValue(new Error("Forbidden"));
    const user = userEvent.setup();
    render(
      <TrendsExportDropdown
        sortBy="velocity"
        language=""
        minStars={null}
        onSaved={onSaved}
        onFailed={onFailed}
      />
    );
    await user.click(screen.getByTestId("trends-export-btn"));
    await user.click(screen.getByText("Export JSON"));

    await waitFor(() => expect(onFailed).toHaveBeenCalled());
    expect(vi.mocked(onFailed).mock.calls[0][0]).toContain("Forbidden");
  });

  it("closes menu when JSON link is clicked", async () => {
    const user = userEvent.setup();
    render(
      <TrendsExportDropdown
        sortBy="velocity"
        language=""
        minStars={null}
        onSaved={onSaved}
        onFailed={onFailed}
      />
    );
    await user.click(screen.getByTestId("trends-export-btn"));
    expect(screen.getByTestId("trends-export-menu")).toBeInTheDocument();

    await user.click(screen.getByText("Export JSON"));
    expect(screen.queryByTestId("trends-export-menu")).not.toBeInTheDocument();
  });

  it("toggles menu on repeated clicks", async () => {
    const user = userEvent.setup();
    render(
      <TrendsExportDropdown
        sortBy="velocity"
        language=""
        minStars={null}
        onSaved={onSaved}
        onFailed={onFailed}
      />
    );

    await user.click(screen.getByTestId("trends-export-btn"));
    expect(screen.getByTestId("trends-export-menu")).toBeInTheDocument();

    await user.click(screen.getByTestId("trends-export-btn"));
    expect(screen.queryByTestId("trends-export-menu")).not.toBeInTheDocument();
  });
});
