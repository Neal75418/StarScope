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

  it("keeps the backfill's error when the status is read back successfully", async () => {
    // 回填動作的說明是它自己的：讀回狀態成功只清掉讀狀態那邊的說明（離線），不清掉回填失敗的原因
    // 延遲回應（像真的 HTTP）：立刻回應的 mock 會讓 React Query 把 isFetching 的 true→false 通知合併掉，
    // useBackfillStatus 的 effect 不跑，舊寫法清掉錯誤的那一步也就測不到
    const later = <T,>(settle: () => T) =>
      new Promise<T>((resolve, reject) =>
        setTimeout(() => {
          try {
            resolve(settle());
          } catch (e) {
            reject(e);
          }
        }, 10)
      );
    vi.mocked(apiClient.getBackfillStatus)
      .mockImplementationOnce(() =>
        later(() => {
          throw new apiClient.ApiError(500, "Internal server error");
        })
      )
      .mockImplementation(() =>
        later(() => ({
          repo_id: 1,
          repo_name: "test/repo",
          can_backfill: true,
          current_stars: 100,
          max_stars_allowed: 5000,
          has_backfilled_data: false,
          backfilled_days: 0,
          message: "",
        }))
      );
    vi.mocked(apiClient.backfillStarHistory).mockRejectedValue(
      new apiClient.ApiError(502, "GitHub authentication failed", "GITHUB_AUTH_FAILED")
    );
    renderBackfill();
    await screen.findByText(t.starHistory.statusLoadFailed);

    fireEvent.click(screen.getByRole("button", { name: t.starHistory.backfill }));
    const reason = t.failure.githubAuth;
    await screen.findByText(reason, { exact: false });

    // 回填失敗後自己會重讀狀態（徽章要跟上）：讀回成功、讀不到的說明消失，回填失敗的原因要還在
    await waitFor(() =>
      expect(screen.queryByText(t.starHistory.statusLoadFailed)).not.toBeInTheDocument()
    );
    expect(screen.getByText(reason, { exact: false })).toBeInTheDocument();
  });

  it("says the status is offline when the engine can't be reached", async () => {
    vi.mocked(apiClient.getBackfillStatus).mockRejectedValue(
      new apiClient.ApiError(0, "Network error: Load failed")
    );
    renderBackfill();

    expect(await screen.findByText(t.starHistory.offline)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.starHistory.backfill })).toBeDisabled();
  });
});
