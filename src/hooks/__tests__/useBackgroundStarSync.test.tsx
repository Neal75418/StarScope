/**
 * 背景的星標同步（sidecar 啟動時的同步、launchd 收集器）不會通知前端：只能自己去看最後同步時間，
 * 變了就重取追蹤名單，分類與警報規則才會跟上 GitHub 上的 star／取消 star。
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
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useBackgroundStarSync(enabled), { wrapper });
  const reposInvalidated = () => client.getQueryState(queryKeys.repos.lists())?.isInvalidated;
  return { client, hook, reposInvalidated };
}

const status = (last_sync_at: string | null) => ({ last_sync_at, running: false });
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
    // 它自己觸發的重取也會重讀同步狀態（key 在 repos 底下）：讀到同一個值不能再觸發，否則會繞圈
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
    // 那不是新的同步
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
