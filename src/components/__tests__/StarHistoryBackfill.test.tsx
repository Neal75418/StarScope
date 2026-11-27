/**
 * 回填區塊：讀不到回填狀態時說讀不到並給重試（不說成離線、不停用回填鈕）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import type { ReactNode } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { StarHistoryBackfill } from "../StarHistoryBackfill";
import * as apiClient from "../../api/client";
import { createTestQueryClient } from "../../lib/react-query";
import { translations } from "../../i18n/translations";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return { ...actual, getBackfillStatus: vi.fn(), backfillStarHistory: vi.fn() };
});

const t = translations.en;

function renderBackfill() {
  const client = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return render(<StarHistoryBackfill repoId={1} currentStars={100} />, { wrapper });
}

describe("StarHistoryBackfill", () => {
  beforeEach(() => {
    vi.mocked(apiClient.getBackfillStatus).mockReset();
  });

  it("says the status could not be loaded and offers a retry, without calling it offline", async () => {
    vi.mocked(apiClient.getBackfillStatus).mockRejectedValue(
      new apiClient.ApiError(500, "Internal server error")
    );
    renderBackfill();

    expect(await screen.findByText(t.starHistory.statusLoadFailed)).toBeInTheDocument();
    expect(
      screen.queryByText(t.starHistory.offlineLabel, { exact: false })
    ).not.toBeInTheDocument();
    // 引擎連得到：回填照常可以按
    expect(screen.getByRole("button", { name: t.starHistory.backfill })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: t.common.retry }));
    await waitFor(() => expect(apiClient.getBackfillStatus).toHaveBeenCalledTimes(2));
  });

  it("keeps the retry button in place while retrying before any status was read", async () => {
    // 還沒有資料時重讀，React Query 會把查詢改回 pending：整塊不能被換成「檢查中」，重試鈕要留著顯示重試中
    vi.mocked(apiClient.getBackfillStatus)
      .mockRejectedValueOnce(new apiClient.ApiError(500, "Internal server error"))
      .mockImplementationOnce(() => new Promise(() => {}));
    renderBackfill();
    await screen.findByText(t.starHistory.statusLoadFailed);

    fireEvent.click(screen.getByRole("button", { name: t.common.retry }));

    expect(await screen.findByRole("button", { name: t.common.retrying })).toBeInTheDocument();
    expect(screen.queryByText(t.starHistory.checking)).not.toBeInTheDocument();
  });
});
