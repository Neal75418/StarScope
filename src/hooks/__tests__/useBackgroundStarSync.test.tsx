/**
 * 背景的星標同步（sidecar 啟動時的同步、launchd 收集器）與抓取（排程、收集器）不會通知前端：只能自己去看
 * 最後同步時間、最新快照與最新情境訊號（HN、新版本）的寫入時間，變了就重取追蹤名單與儀表板：分類與警報規則跟上
 * GitHub 上的 star／取消 star，追蹤名單、訊號與儀表板跟上新的星數，近 7 天摘要與卡片的情境徽章跟上新的 HN 與新版本。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useBackgroundStarSync } from "../useBackgroundStarSync";
import { getSyncStatus } from "../../api/client";
import { queryKeys } from "../../lib/react-query";

vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  getSyncStatus: vi.fn(),
}));

function renderWatcher(enabled = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // 代表追蹤名單的快取：被標成過期＝watcher 要求重取了
  client.setQueryData(queryKeys.repos.lists(), []);
  // 儀表板「最後更新」標籤讀的那份
  client.setQueryData([...queryKeys.connection.all, "diagnostics"], {});
  // 儀表板的週摘要：也是從快照算的
  client.setQueryData(queryKeys.dashboard.weeklySummary(), {});
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useBackgroundStarSync(enabled), { wrapper });
  const reposInvalidated = () => client.getQueryState(queryKeys.repos.lists())?.isInvalidated;
  const diagnosticsInvalidated = () =>
    client.getQueryState([...queryKeys.connection.all, "diagnostics"])?.isInvalidated;
  const dashboardInvalidated = () =>
    client.getQueryState(queryKeys.dashboard.weeklySummary())?.isInvalidated;
  return { client, hook, reposInvalidated, diagnosticsInvalidated, dashboardInvalidated };
}

const status = (
  last_sync_at: string | null,
  last_snapshot_at: string | null = null,
  last_context_signal_at: string | null = null
) => ({
  last_sync_at,
  running: false,
  last_snapshot_at,
  last_context_signal_at,
});
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 20)));

describe("useBackgroundStarSync", () => {
  beforeEach(() => {
    vi.mocked(getSyncStatus).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("takes the first reading as the baseline without reloading anything", async () => {
    vi.mocked(getSyncStatus).mockResolvedValue(status("2026-09-29T10:00:00Z"));
    const { reposInvalidated } = renderWatcher();

    await waitFor(() => expect(getSyncStatus).toHaveBeenCalledTimes(1));
    await settle();

    expect(reposInvalidated()).toBe(false);
  });

  it("reloads the tracked repos when a sync finished in the background", async () => {
    vi.mocked(getSyncStatus)
      .mockResolvedValueOnce(status("2026-09-29T10:00:00Z"))
      .mockResolvedValueOnce(status("2026-09-29T11:00:00Z"));
    const { client, reposInvalidated } = renderWatcher();
    await waitFor(() => expect(getSyncStatus).toHaveBeenCalledTimes(1));
    await settle();

    await act(() => client.refetchQueries({ queryKey: queryKeys.repos.syncStatus() }));

    await waitFor(() => expect(reposInvalidated()).toBe(true));
  });

  it("reloads the tracked repos and the fetch time when a background fetch wrote new data", async () => {
    // 排程與 launchd 收集器的抓取不會通知前端：沒有同步、只有抓取時，最後同步時間不會變
    vi.mocked(getSyncStatus)
      .mockResolvedValueOnce(status("2026-09-29T10:00:00Z", "2026-11-26T03:00:00+00:00"))
      .mockResolvedValueOnce(status("2026-09-29T10:00:00Z", "2026-11-26T03:30:00+00:00"));
    const { client, reposInvalidated, diagnosticsInvalidated, dashboardInvalidated } =
      renderWatcher();
    await waitFor(() => expect(getSyncStatus).toHaveBeenCalledTimes(1));
    await settle();
    expect(reposInvalidated()).toBe(false);
    expect(diagnosticsInvalidated()).toBe(false);
    expect(dashboardInvalidated()).toBe(false);

    await act(() => client.refetchQueries({ queryKey: queryKeys.repos.syncStatus() }));

    await waitFor(() => expect(reposInvalidated()).toBe(true));
    expect(diagnosticsInvalidated()).toBe(true);
    // 週摘要與每日 star 也從快照算（dashboard 底下）
    expect(dashboardInvalidated()).toBe(true);
  });

  it("reloads the weekly summary and the tracked repos when only HN or releases were written", async () => {
    // HN 與新版本由另外的排程寫：快照時間與同步時間都沒變，近 7 天摘要與卡片的情境徽章要靠這個時間
    vi.mocked(getSyncStatus)
      .mockResolvedValueOnce(
        status("2026-09-29T10:00:00Z", "2026-11-26T03:00:00+00:00", "2026-11-26T03:05:00+00:00")
      )
      .mockResolvedValueOnce(
        status("2026-09-29T10:00:00Z", "2026-11-26T03:00:00+00:00", "2026-11-26T03:35:00+00:00")
      );
    const { client, reposInvalidated, dashboardInvalidated } = renderWatcher();
    await waitFor(() => expect(getSyncStatus).toHaveBeenCalledTimes(1));
    await settle();
    expect(dashboardInvalidated()).toBe(false);

    await act(() => client.refetchQueries({ queryKey: queryKeys.repos.syncStatus() }));

    await waitFor(() => expect(dashboardInvalidated()).toBe(true));
    // 追蹤清單重讀過，卡片的情境徽章才會重抓（見 useWindowedBatchRepoData 的 dataVersion）
    expect(reposInvalidated()).toBe(true);
  });

  it("does not keep reading its own status again while a background fetch is still writing", async () => {
    // 收集器每寫完一個 repo，最新快照時間就往前走：重取追蹤名單時連同步狀態一起重讀的話（key 在 repos 底下），
    // 每次都讀到新值、又觸發一次，一路連到寫完為止
    let tick = 0;
    vi.mocked(getSyncStatus).mockImplementation(() => {
      tick += 1;
      return Promise.resolve(
        status("2026-09-29T10:00:00Z", `2026-11-26T03:00:${String(tick).padStart(2, "0")}+00:00`)
      );
    });
    const { client, reposInvalidated } = renderWatcher();
    await waitFor(() => expect(getSyncStatus).toHaveBeenCalledTimes(1));
    await settle();

    await act(() => client.refetchQueries({ queryKey: queryKeys.repos.syncStatus() }));
    await waitFor(() => expect(reposInvalidated()).toBe(true));
    await act(() => new Promise<void>((r) => setTimeout(r, 100)));

    // 第一次讀到＋明確重讀一次，沒有自己再讀；寫入期間的最後一個值由下一輪（一分鐘後）接到
    expect(getSyncStatus).toHaveBeenCalledTimes(2);
  });

  it("treats the very first sync after install as a change", async () => {
    // 從沒同步過（null）到有值，同樣是剛完成一次同步
    vi.mocked(getSyncStatus)
      .mockResolvedValueOnce(status(null))
      .mockResolvedValueOnce(status("2026-09-29T10:00:00Z"));
    const { client, reposInvalidated } = renderWatcher();
    await waitFor(() => expect(getSyncStatus).toHaveBeenCalledTimes(1));
    await settle();
    expect(reposInvalidated()).toBe(false);

    await act(() => client.refetchQueries({ queryKey: queryKeys.repos.syncStatus() }));

    await waitFor(() => expect(reposInvalidated()).toBe(true));
  });

  it("does not reload again when a later reading has not changed", async () => {
    // 之後的輪詢、或別處的重讀（例如刪除分類之後的 invalidateTrackedRepos）讀到同一個值，不能再觸發
    vi.mocked(getSyncStatus)
      .mockResolvedValueOnce(status("2026-09-29T10:00:00Z"))
      .mockResolvedValueOnce(status("2026-09-29T11:00:00Z"))
      .mockResolvedValue(status("2026-09-29T11:00:00Z"));
    const { client, reposInvalidated } = renderWatcher();
    await waitFor(() => expect(getSyncStatus).toHaveBeenCalledTimes(1));
    await settle();
    await act(() => client.refetchQueries({ queryKey: queryKeys.repos.syncStatus() }));
    await waitFor(() => expect(reposInvalidated()).toBe(true));
    await settle();
    client.setQueryData(queryKeys.repos.lists(), []);

    await act(() => client.refetchQueries({ queryKey: queryKeys.repos.syncStatus() }));
    await settle();

    expect(reposInvalidated()).toBe(false);
  });

  it("does not count the same reading after Reset All Data cleared the cache", async () => {
    // 重設會 queryClient.clear()：資料先變 undefined、再讀回同一個時間（後端重設不清最後同步時間），
    // 那不是新的同步。這條只守「快取清掉、讀回同一個值」；真的重設還會刪光快照，快照時間從有變成沒有，
    // 算一次變化（重讀的都是重設之後送的請求，無害，見 hook 裡的說明）
    vi.mocked(getSyncStatus).mockResolvedValue(status("2026-09-29T10:00:00Z"));
    const { client, hook, reposInvalidated } = renderWatcher();
    await waitFor(() => expect(getSyncStatus).toHaveBeenCalledTimes(1));
    await settle();

    act(() => client.clear());
    client.setQueryData(queryKeys.repos.lists(), []);
    hook.rerender();
    await waitFor(() => expect(getSyncStatus).toHaveBeenCalledTimes(2));
    await settle();

    expect(reposInvalidated()).toBe(false);
  });

  it("checks again every minute", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(getSyncStatus).mockResolvedValue(status("2026-09-29T10:00:00Z"));
    renderWatcher();
    await waitFor(() => expect(getSyncStatus).toHaveBeenCalledTimes(1));

    await act(() => vi.advanceTimersByTimeAsync(59_000));
    expect(getSyncStatus).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(2_000));

    await waitFor(() => expect(getSyncStatus).toHaveBeenCalledTimes(2));
  });

  it("stays quiet while the sidecar is not connected", async () => {
    vi.mocked(getSyncStatus).mockResolvedValue(status("2026-09-29T10:00:00Z"));
    renderWatcher(false);
    await settle();

    expect(getSyncStatus).not.toHaveBeenCalled();
  });
});
