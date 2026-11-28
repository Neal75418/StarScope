import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import type { ReactNode } from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useBackfillAction } from "../useBackfillAction";
import * as apiClient from "../../api/client";
import { API_ERROR_MESSAGES } from "../../constants/api";
import { interpolate } from "../../i18n";
import { translations } from "../../i18n/translations";
import { createTestQueryClient, queryKeys } from "../../lib/react-query";

const t = translations.en;
const keepRefetchingMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/react-query")>()),
  keepRefetchingAfterTimeout: keepRefetchingMock,
}));

let client = createTestQueryClient();
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client }, children);

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    backfillStarHistory: vi.fn(),
  };
});

describe("useBackfillAction", () => {
  const mockOnSuccess = vi.fn().mockResolvedValue(undefined);

  const defaultProps = {
    repoId: 1,
    isOffline: false,
    onSuccess: mockOnSuccess,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    client = createTestQueryClient();
    // 預先放進去的圖表快取沒有觀察者，gcTime 0 會馬上被回收、讀不到「要重讀」的標記
    client.setDefaultOptions({
      queries: { ...client.getDefaultOptions().queries, gcTime: Infinity },
    });
  });

  it("returns initial state", () => {
    const { result } = renderHook(() => useBackfillAction(defaultProps), { wrapper });

    expect(result.current.backfilling).toBe(false);
    expect(result.current.successMessage).toBe(null);
    expect(typeof result.current.handleBackfill).toBe("function");
  });

  it("sets error when offline", async () => {
    const { result } = renderHook(() => useBackfillAction({ ...defaultProps, isOffline: true }), {
      wrapper,
    });

    await act(async () => {
      await result.current.handleBackfill();
    });

    expect(result.current.errorMessage).toBe("Cannot backfill while offline");
    expect(apiClient.backfillStarHistory).not.toHaveBeenCalled();
  });

  it("handles successful backfill", async () => {
    vi.mocked(apiClient.backfillStarHistory).mockResolvedValue({
      repo_id: 1,
      repo_name: "test/repo",
      success: true,
      total_stargazers: 100,
      snapshots_created: 5,
      earliest_date: "2024-01-01",
      latest_date: "2024-01-31",
      message: "Success",
      code: null,
    });

    const { result } = renderHook(() => useBackfillAction(defaultProps), { wrapper });

    await act(async () => {
      await result.current.handleBackfill();
    });

    await waitFor(() => {
      expect(result.current.backfilling).toBe(false);
    });

    expect(result.current.successMessage).toBe("Backfill complete! Created 5 data points.");
    expect(mockOnSuccess).toHaveBeenCalled();
  });

  it("marks every time range of this repo's chart to be re-read after a successful backfill", async () => {
    // 只重讀目前這個範圍的話，切到之前看過的其他範圍（例如「全部」），5 分鐘內還是回填前的資料
    vi.mocked(apiClient.backfillStarHistory).mockResolvedValue({
      repo_id: 1,
      repo_name: "test/repo",
      success: true,
      total_stargazers: 100,
      snapshots_created: 5,
      earliest_date: "2024-01-01",
      latest_date: "2024-01-31",
      message: "Success",
      code: null,
    });
    client.setQueryData(queryKeys.starsChart.data(1, "30d"), []);
    client.setQueryData(queryKeys.starsChart.data(1, "all"), []);
    client.setQueryData(queryKeys.starsChart.data(2, "all"), []);

    const { result } = renderHook(() => useBackfillAction(defaultProps), { wrapper });
    await act(async () => {
      await result.current.handleBackfill();
    });

    expect(client.getQueryState(queryKeys.starsChart.data(1, "30d"))?.isInvalidated).toBe(true);
    expect(client.getQueryState(queryKeys.starsChart.data(1, "all"))?.isInvalidated).toBe(true);
    expect(client.getQueryState(queryKeys.starsChart.data(2, "all"))?.isInvalidated).toBe(false);
  });

  const refused = (code: string | null) => ({
    repo_id: 1,
    repo_name: "test/repo",
    success: false,
    total_stargazers: 0,
    snapshots_created: 0,
    earliest_date: null,
    latest_date: null,
    message: "Repository has too many stars (>5000). Backfill is not available.",
    code,
  });

  it("says a repository over the star limit can't be backfilled, in the app's words", async () => {
    vi.mocked(apiClient.backfillStarHistory).mockResolvedValue(refused("TOO_MANY_STARS"));

    const { result } = renderHook(() => useBackfillAction(defaultProps), { wrapper });

    await act(async () => {
      await result.current.handleBackfill();
    });

    expect(result.current.errorMessage).toBe(
      interpolate(t.starHistory.backfillTooManyStars, { count: 5000 })
    );
    expect(mockOnSuccess).not.toHaveBeenCalled();
  });

  it("does not show the server's message for a refusal it doesn't know", async () => {
    vi.mocked(apiClient.backfillStarHistory).mockResolvedValue(refused(null));

    const { result } = renderHook(() => useBackfillAction(defaultProps), { wrapper });

    await act(async () => {
      await result.current.handleBackfill();
    });

    expect(result.current.errorMessage).toBe(
      interpolate(t.failure.withCause, {
        outcome: t.starHistory.backfillFailure.notDone,
        cause: t.failure.retry,
      })
    );
  });

  it("does not call a server error being offline", async () => {
    vi.mocked(apiClient.backfillStarHistory).mockRejectedValue(
      new apiClient.ApiError(500, "Server error")
    );

    client.setQueryData(queryKeys.starsChart.data(1, "30d"), []);
    const { result } = renderHook(() => useBackfillAction(defaultProps), { wrapper });

    await act(async () => {
      await result.current.handleBackfill();
    });

    expect(result.current.errorMessage).toBe(
      interpolate(t.failure.withCause, {
        outcome: t.starHistory.backfillFailure.notDone,
        cause: t.failure.retry,
      })
    );
    expect(result.current.backfilling).toBe(false);
    // 失敗之後一律重讀這個 repo 的圖表；不是逾時就不用接著定期重讀
    expect(client.getQueryState(queryKeys.starsChart.data(1, "30d"))?.isInvalidated).toBe(true);
    expect(keepRefetchingMock).not.toHaveBeenCalled();
  });

  it("clears the timeout warning when backfill is tried again", async () => {
    vi.mocked(apiClient.backfillStarHistory)
      .mockRejectedValueOnce(new apiClient.ApiError(0, API_ERROR_MESSAGES.TIMED_OUT))
      .mockRejectedValueOnce(new apiClient.ApiError(500, "Server error"));
    const { result } = renderHook(() => useBackfillAction(defaultProps), { wrapper });

    await act(async () => {
      await result.current.handleBackfill();
    });
    expect(result.current.warningMessage).not.toBeNull();

    await act(async () => {
      await result.current.handleBackfill();
    });
    expect(result.current.warningMessage).toBeNull();
  });

  it("clears the previous failure when backfill succeeds on the next try", async () => {
    vi.mocked(apiClient.backfillStarHistory)
      .mockRejectedValueOnce(new apiClient.ApiError(500, "Server error"))
      .mockResolvedValueOnce({ ...refused(null), success: true, snapshots_created: 2 });
    const { result } = renderHook(() => useBackfillAction(defaultProps), { wrapper });

    await act(async () => {
      await result.current.handleBackfill();
    });
    expect(result.current.errorMessage).not.toBeNull();

    await act(async () => {
      await result.current.handleBackfill();
    });
    expect(result.current.errorMessage).toBeNull();
    expect(result.current.successMessage).not.toBeNull();
  });

  it("keeps re-reading the chart for a while after a timeout: the server may still be writing", async () => {
    vi.mocked(apiClient.backfillStarHistory).mockRejectedValue(
      new apiClient.ApiError(0, API_ERROR_MESSAGES.TIMED_OUT)
    );
    client.setQueryData(queryKeys.starsChart.data(1, "30d"), []);
    client.setQueryData(queryKeys.starsChart.data(2, "30d"), []);

    const { result } = renderHook(() => useBackfillAction(defaultProps), { wrapper });

    await act(async () => {
      await result.current.handleBackfill();
    });

    // 不確定不是失敗：用警告、不走錯誤（錯誤是紅字＋role=alert）
    expect(result.current.warningMessage).toBe(t.starHistory.backfillFailure.timedOut);
    expect(result.current.errorMessage).toBeNull();
    expect(keepRefetchingMock).toHaveBeenCalledTimes(1);
    // 失敗當下已經重讀過一次：重設成剛讀回的樣子，才分得出接下來的定期重讀碰的是哪一份
    client.setQueryData(queryKeys.starsChart.data(1, "30d"), []);
    client.setQueryData(queryKeys.starsChart.data(2, "30d"), []);
    client.setQueryData(queryKeys.backfill.status(1), null);
    expect(client.getQueryState(queryKeys.starsChart.data(1, "30d"))?.isInvalidated).toBe(false);
    // 交給它的重讀碰的是這個 repo 的圖表（元件卸載之後也有效：走 queryClient），不是別的 repo
    keepRefetchingMock.mock.calls[0][0]();
    expect(client.getQueryState(queryKeys.starsChart.data(1, "30d"))?.isInvalidated).toBe(true);
    expect(client.getQueryState(queryKeys.starsChart.data(2, "30d"))?.isInvalidated).toBe(false);
    // 回填狀態（徽章「已有 N 天資料」）也一起：回填動作的說明是 hook 自己的 state，狀態讀回來不會清掉它
    expect(client.getQueryState(queryKeys.backfill.status(1))?.isInvalidated).toBe(true);
  });

  it("does not report backfill failure when onSuccess refresh throws", async () => {
    vi.mocked(apiClient.backfillStarHistory).mockResolvedValue({
      repo_id: 1,
      repo_name: "test/repo",
      success: true,
      total_stargazers: 100,
      snapshots_created: 5,
      earliest_date: "2024-01-01",
      latest_date: "2024-01-31",
      message: "Success",
      code: null,
    });
    mockOnSuccess.mockRejectedValue(new Error("Refresh failed"));
    client.setQueryData(queryKeys.starsChart.data(1, "30d"), []);

    const { result } = renderHook(() => useBackfillAction(defaultProps), { wrapper });

    await act(async () => {
      await result.current.handleBackfill();
    });

    // 回填成功：重讀狀態失敗不算回填失敗
    expect(result.current.errorMessage).toBeNull();
    // Success message should still be set
    expect(result.current.successMessage).toBe("Backfill complete! Created 5 data points.");
    // 圖表照樣重讀：回填本身成功了
    expect(client.getQueryState(queryKeys.starsChart.data(1, "30d"))?.isInvalidated).toBe(true);
  });

  it("sets backfilling state during operation", async () => {
    let resolveBackfill: ((value: apiClient.BackfillResult) => void) | null = null;
    vi.mocked(apiClient.backfillStarHistory).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBackfill = resolve;
        })
    );

    const { result } = renderHook(() => useBackfillAction(defaultProps), { wrapper });

    act(() => {
      void result.current.handleBackfill();
    });

    expect(result.current.backfilling).toBe(true);

    await act(async () => {
      if (resolveBackfill) {
        resolveBackfill({
          repo_id: 1,
          repo_name: "test/repo",
          success: true,
          total_stargazers: 10,
          snapshots_created: 1,
          earliest_date: "2024-01-01",
          latest_date: "2024-01-01",
          message: "",
          code: null,
        });
      }
    });

    expect(result.current.backfilling).toBe(false);
  });
});
