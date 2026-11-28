import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useState } from "react";
import { useWindowedBatchRepoData } from "../useWindowedBatchRepoData";

// Mock API
const mockBadgesResponse = {
  "1": {
    repo_id: 1,
    badges: [
      { type: "hn" as const, label: "HN", url: "https://hn.com", score: 100, is_recent: true },
    ],
  },
  "2": { repo_id: 2, badges: [] },
};
const mockSignalsResponse = {
  "1": {
    signals: [
      {
        id: 100,
        repo_id: 1,
        signal_type: "rising_star",
        severity: "medium",
        description: "test",
        detected_at: "2024-01-01",
        acknowledged: false,
      },
    ],
  },
  "2": { signals: [] },
};

vi.mock("../../api/client", () => ({
  getContextBadgesBatch: vi.fn(() => Promise.resolve(mockBadgesResponse)),
  getRepoSignalsBatch: vi.fn(() => Promise.resolve(mockSignalsResponse)),
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

describe("useWindowedBatchRepoData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty dataMap when no repo IDs provided", () => {
    const { result } = renderHook(() => useWindowedBatchRepoData([]));

    expect(result.current.dataMap).toEqual({});
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("fetches data for visible repo IDs", async () => {
    const { getContextBadgesBatch, getRepoSignalsBatch } = await import("../../api/client");

    const { result } = renderHook(() => useWindowedBatchRepoData([1, 2], { debounceMs: 0 }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(getContextBadgesBatch).toHaveBeenCalled();
      expect(getRepoSignalsBatch).toHaveBeenCalled();
    });

    expect(result.current.dataMap[1].badges).toHaveLength(1);
    expect(result.current.dataMap[1].signals).toHaveLength(1);
    expect(result.current.dataMap[2].badges).toHaveLength(0);
  });

  it("setVisibleRange updates the visible window", async () => {
    const { result } = renderHook(() => useWindowedBatchRepoData([1, 2, 3], { debounceMs: 0 }));

    act(() => {
      result.current.setVisibleRange({ start: 0, stop: 2 });
    });

    // After setting range, the hook should still resolve and provide data
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Verify dataMap is populated for the visible IDs
    expect(result.current.dataMap[1]).toBeDefined();
    expect(result.current.dataMap[2]).toBeDefined();
  });

  it("returns empty badges and signals for IDs not in API response", async () => {
    const { result } = renderHook(() => useWindowedBatchRepoData([1, 2, 999], { debounceMs: 0 }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // ID 999 not in mock response — dataMap only contains loaded entries
    expect(result.current.dataMap[999]).toBeUndefined();
  });

  it("handles API error gracefully", async () => {
    const { getContextBadgesBatch } = await import("../../api/client");
    // 用 mockImplementation 確保所有呼叫都 reject（包含 debounce 後的延遲呼叫）
    vi.mocked(getContextBadgesBatch).mockImplementation(() =>
      Promise.reject(new Error("Network error"))
    );

    const { result } = renderHook(() => useWindowedBatchRepoData([1], { debounceMs: 0 }));

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.error?.message).toBe("Network error");
    expect(result.current.loading).toBe(false);

    // clearAllMocks in beforeEach 會恢復 mock，無需手動恢復
  });

  it("does not re-fetch already loaded IDs", async () => {
    const { getContextBadgesBatch, getRepoSignalsBatch } = await import("../../api/client");

    const { result, rerender } = renderHook(
      ({ ids }: { ids: number[] }) => useWindowedBatchRepoData(ids, { debounceMs: 0 }),
      { initialProps: { ids: [1, 2] } }
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const callCountBadges = vi.mocked(getContextBadgesBatch).mock.calls.length;
    const callCountSignals = vi.mocked(getRepoSignalsBatch).mock.calls.length;

    // Re-render with same IDs — should not trigger new fetch
    rerender({ ids: [1, 2] });

    // Flush microtasks to ensure no new calls are pending
    await act(async () => {});

    expect(vi.mocked(getContextBadgesBatch).mock.calls.length).toBe(callCountBadges);
    expect(vi.mocked(getRepoSignalsBatch).mock.calls.length).toBe(callCountSignals);
  });

  it("in-flight 批次不因視窗改變而中止（regression：中止會讓這些 id 卡死）", async () => {
    // 死鎖序列：批次起飛 → 視窗改變使 missingIds 變空 → 舊碼在 cleanup abort
    // 並清掉 loadingSet → 之後沒有任何 re-render 會把這些 id 撿回來。
    const { getContextBadgesBatch } = await import("../../api/client");
    let resolveBadges: (() => void) | undefined;
    vi.mocked(getContextBadgesBatch).mockImplementation(
      () =>
        new Promise((res) => {
          resolveBadges = () => res(mockBadgesResponse);
        })
    );

    const { result } = renderHook(() => useWindowedBatchRepoData([1, 2], { debounceMs: 0 }));

    await waitFor(() => {
      expect(vi.mocked(getContextBadgesBatch)).toHaveBeenCalled();
    });

    // 批次仍在途時改變視窗：target 內容不變但 missingIds 變空 → effect 重跑
    act(() => {
      result.current.setVisibleRange({ start: 0, stop: 1 });
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });

    // 放行第一批 — 結果必須落地（舊碼因已 abort 而整批丟棄）
    await act(async () => {
      resolveBadges?.();
    });

    await waitFor(() => {
      expect(result.current.dataMap[1]).toBeDefined();
      expect(result.current.dataMap[2]).toBeDefined();
      expect(result.current.loading).toBe(false);
    });
  });

  it("被取代批次的失敗不得汙染當前視窗的 error / batchOwnsData", async () => {
    // error 同時是 batchOwnsData：若舊批次的暫時性失敗寫進全域 error，
    // 整頁會掉回每卡自抓的 N+1 模式，且要等下一個有 missingIds 的 effect 才復原
    const { getContextBadgesBatch } = await import("../../api/client");
    let rejectA: ((e: Error) => void) | undefined;
    vi.mocked(getContextBadgesBatch)
      .mockImplementationOnce(
        () =>
          new Promise((_, rej) => {
            rejectA = rej;
          })
      )
      .mockResolvedValue({ "3": { repo_id: 3, badges: [] } });

    const { result, rerender } = renderHook(
      ({ ids }: { ids: number[] }) => useWindowedBatchRepoData(ids, { debounceMs: 0 }),
      { initialProps: { ids: [1, 2] } }
    );

    await waitFor(() => {
      expect(vi.mocked(getContextBadgesBatch)).toHaveBeenCalledTimes(1);
    });

    // 視窗移到新批次（B），B 成功落地
    rerender({ ids: [3] });
    await waitFor(() => expect(result.current.dataMap[3]).toBeDefined());

    // 舊批次 A 這時才失敗——不得動到 error
    await act(async () => {
      rejectA?.(new Error("stale batch failure"));
    });

    expect(result.current.error).toBeNull();
    expect(result.current.batchOwnsData).toBe(true);
  });

  describe("追蹤清單重讀過（dataVersion 變了）", () => {
    // clearAllMocks 不清 mock*Once 的佇列：一條失敗沒用完的 once 會漏到下一條
    beforeEach(async () => {
      const api = await import("../../api/client");
      vi.mocked(api.getRepoSignalsBatch)
        .mockReset()
        .mockImplementation(() => Promise.resolve(mockSignalsResponse) as never);
      vi.mocked(api.getContextBadgesBatch)
        .mockReset()
        .mockImplementation(() => Promise.resolve(mockBadgesResponse) as never);
    });

    // 卡片上的「N 個活躍訊號」與情境徽章由這裡批次抓：卡片上的抓取、全部重新整理、背景抓取之後追蹤清單會重讀，
    // 這裡要跟著重抓（卡片怎麼採用新的一批見 useRepoCardData 與 useWindowedBatchRepoData.card.test）

    // 同一個陣列：頁面上的 id 清單有 memo，追蹤清單重讀到一樣的內容時陣列不變。
    // 每次 render 都給新陣列的話，id 清單本身就會觸發重算，測不到版本有沒有接上
    const ids = [1, 2];

    const signalsWith = (count: number) => ({
      "1": {
        signals: Array.from({ length: count }, (_, i) => ({
          id: 100 + i,
          repo_id: 1,
          signal_type: "rising_star",
          severity: "medium",
          description: "test",
          detected_at: "2024-01-01",
          acknowledged: false,
        })),
      },
      "2": { signals: [] },
    });

    it("re-fetches what is on screen when the tracked list was read again", async () => {
      const { getRepoSignalsBatch } = await import("../../api/client");
      vi.mocked(getRepoSignalsBatch)
        .mockResolvedValueOnce(signalsWith(1) as never)
        .mockResolvedValueOnce(signalsWith(3) as never);
      const { result, rerender } = renderHook(
        ({ version }) => useWindowedBatchRepoData(ids, { debounceMs: 0, dataVersion: version }),
        { initialProps: { version: 1 } }
      );
      await waitFor(() => expect(result.current.dataMap[1]?.signals).toHaveLength(1));

      rerender({ version: 2 });

      await waitFor(() => expect(result.current.dataMap[1]?.signals).toHaveLength(3));
      expect(getRepoSignalsBatch).toHaveBeenCalledTimes(2);
    });

    it("keeps showing what was loaded while re-fetching", async () => {
      // 追蹤清單每次重讀都會換版本：重抓期間清空的話，卡片上的徽章與訊號會先消失再出現
      const { getRepoSignalsBatch } = await import("../../api/client");
      let releaseNew: (v: unknown) => void = () => {};
      vi.mocked(getRepoSignalsBatch)
        .mockResolvedValueOnce(signalsWith(1) as never)
        .mockImplementationOnce(() => new Promise((r) => (releaseNew = r)) as never);
      const { result, rerender } = renderHook(
        ({ version }) => useWindowedBatchRepoData(ids, { debounceMs: 0, dataVersion: version }),
        { initialProps: { version: 1 } }
      );
      await waitFor(() => expect(result.current.dataMap[1]?.signals).toHaveLength(1));

      rerender({ version: 2 });
      await waitFor(() => expect(getRepoSignalsBatch).toHaveBeenCalledTimes(2));

      expect(result.current.dataMap[1]?.signals).toHaveLength(1);
      expect(result.current.dataMap[1]?.badges).toEqual(mockBadgesResponse["1"].badges);
      await act(async () => {
        releaseNew(signalsWith(3));
      });
      await waitFor(() => expect(result.current.dataMap[1]?.signals).toHaveLength(3));
    });

    it("only fetches what is new when the view moves within the same version", async () => {
      // 每個 id 記著是哪個版本讀到的：記不住的話，捲動時視窗裡已經讀過的也會跟著重抓
      const api = await import("../../api/client");
      const reply = (make: (id: number) => unknown) => (batch: number[]) =>
        Promise.resolve(Object.fromEntries(batch.map((id) => [String(id), make(id)]))) as never;
      vi.mocked(api.getRepoSignalsBatch).mockImplementation(reply(() => ({ signals: [] })));
      vi.mocked(api.getContextBadgesBatch).mockImplementation(
        reply((id) => ({ repo_id: id, badges: [] }))
      );
      const many = Array.from({ length: 40 }, (_, i) => i + 1);
      const { result } = renderHook(() =>
        useWindowedBatchRepoData(many, { bufferSize: 0, debounceMs: 0, dataVersion: 1 })
      );
      await waitFor(() => expect(result.current.dataMap[20]).toBeDefined());

      act(() => result.current.setVisibleRange({ start: 10, stop: 30 }));

      await waitFor(() => expect(result.current.dataMap[30]).toBeDefined());
      expect(vi.mocked(api.getRepoSignalsBatch).mock.lastCall?.[0]).toEqual(many.slice(20, 30));
    });

    it("does not re-fetch while the version stays the same", async () => {
      const { getRepoSignalsBatch } = await import("../../api/client");
      const { result, rerender } = renderHook(
        ({ version }) => useWindowedBatchRepoData(ids, { debounceMs: 0, dataVersion: version }),
        { initialProps: { version: 1 } }
      );
      await waitFor(() => expect(result.current.dataMap[1]).toBeDefined());

      rerender({ version: 1 });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });

      expect(getRepoSignalsBatch).toHaveBeenCalledTimes(1);
    });

    it("re-fetches again when a batch sent before the change comes back after it", async () => {
      const { getRepoSignalsBatch } = await import("../../api/client");
      let releaseOld: (v: unknown) => void = () => {};
      vi.mocked(getRepoSignalsBatch)
        .mockImplementationOnce(() => new Promise((r) => (releaseOld = r)) as never)
        .mockResolvedValueOnce(signalsWith(3) as never)
        .mockResolvedValue(signalsWith(3) as never);
      const { result, rerender } = renderHook(
        ({ version }) => useWindowedBatchRepoData(ids, { debounceMs: 0, dataVersion: version }),
        { initialProps: { version: 1 } }
      );
      await waitFor(() => expect(getRepoSignalsBatch).toHaveBeenCalledTimes(1));

      rerender({ version: 2 });
      // 舊的那批（版本變動前送出）這時才回來，帶著舊的資料
      await act(async () => {
        releaseOld(signalsWith(1));
        await new Promise((r) => setTimeout(r, 20));
      });

      await waitFor(() => expect(result.current.dataMap[1]?.signals).toHaveLength(3));
    });

    it("re-fetches when the change and an earlier batch land in the same render", async () => {
      // 途中那批回來時剛好遇上追蹤清單又重讀，React 把兩個更新合成一次畫面：
      // 缺的 id 跟那批送出時一模一樣，只看 id 的話不會再抓，卡片停在舊資料
      const { getRepoSignalsBatch } = await import("../../api/client");
      let releaseInFlight: (v: unknown) => void = () => {};
      vi.mocked(getRepoSignalsBatch)
        .mockResolvedValueOnce(signalsWith(1) as never)
        .mockImplementationOnce(() => new Promise((r) => (releaseInFlight = r)) as never)
        .mockResolvedValue(signalsWith(3) as never);
      // 版本放在 state 裡：rerender 自己包一層 act、當場畫完，跟批次的結果合不到同一次畫面
      let setVersion: (v: number) => void = () => {};
      const { result } = renderHook(() => {
        const [version, set] = useState(1);
        setVersion = set;
        return useWindowedBatchRepoData(ids, { debounceMs: 0, dataVersion: version });
      });
      await waitFor(() => expect(result.current.dataMap[1]?.signals).toHaveLength(1));
      // 等 debounce 停下：之後沒有別的東西會讓缺的 id 重算
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });

      act(() => setVersion(2));
      await waitFor(() => expect(getRepoSignalsBatch).toHaveBeenCalledTimes(2));

      await act(async () => {
        releaseInFlight(signalsWith(2));
        setVersion(3);
        await new Promise((r) => setTimeout(r, 0));
      });

      await waitFor(() => expect(result.current.dataMap[1]?.signals).toHaveLength(3));
      expect(getRepoSignalsBatch).toHaveBeenCalledTimes(3);
    });
  });
});
