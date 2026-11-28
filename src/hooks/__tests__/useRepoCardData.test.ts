import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { createTestQueryClient } from "../../lib/react-query";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getContextBadges: vi.fn(),
    getRepoSignals: vi.fn(),
  };
});

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { getContextBadges, getRepoSignals } from "../../api/client";
import { useRepoCardData } from "../useRepoCardData";
import { nextRequestSeq } from "../../utils/requestSeq";

const mockGetBadges = vi.mocked(getContextBadges);
const mockGetSignals = vi.mocked(getRepoSignals);

function createWrapper() {
  const client = createTestQueryClient();
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

describe("useRepoCardData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches badges and signals for a repo", async () => {
    const badges = [{ type: "trending", label: "Trending" }];
    const signals = [{ id: 1, signal_type: "spike", acknowledged: false }];

    mockGetBadges.mockResolvedValue({ badges } as never);
    mockGetSignals.mockResolvedValue({ signals } as never);

    const { result } = renderHook(() => useRepoCardData(42), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.badgesLoading).toBe(false);
    });

    expect(result.current.badges).toEqual(badges);
    expect(result.current.signals).toEqual(signals);
    expect(result.current.activeSignalCount).toBe(1);
  });

  it("uses preloaded data instead of fetched data", async () => {
    const preloadedBadges = [{ type: "star", label: "Star" }];
    const preloadedSignals = [{ id: 1, signal_type: "growth", acknowledged: true }];

    mockGetBadges.mockResolvedValue({ badges: [{ type: "other", label: "Other" }] } as never);
    mockGetSignals.mockResolvedValue({ signals: [] } as never);

    const { result } = renderHook(
      () =>
        useRepoCardData(42, {
          badges: preloadedBadges as never,
          signals: preloadedSignals as never,
          requestSeq: nextRequestSeq(),
        }),
      { wrapper: createWrapper() }
    );

    // Should use preloaded data, not fetched data
    expect(result.current.badges).toEqual(preloadedBadges);
    expect(result.current.signals).toEqual(preloadedSignals);
    expect(result.current.badgesLoading).toBe(false);
    expect(result.current.signalsLoading).toBe(false);
  });

  it("counts active (unacknowledged) signals", async () => {
    mockGetBadges.mockResolvedValue({ badges: [] } as never);
    mockGetSignals.mockResolvedValue({
      signals: [
        { id: 1, signal_type: "spike", acknowledged: false },
        { id: 2, signal_type: "growth", acknowledged: true },
        { id: 3, signal_type: "trending", acknowledged: false },
      ],
    } as never);

    const { result } = renderHook(() => useRepoCardData(42), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.signalsLoading).toBe(false);
    });

    expect(result.current.activeSignalCount).toBe(2);
  });

  describe("父層換來新的一批", () => {
    // initialData 只在查詢還沒有資料時生效：追蹤清單重讀後父層重抓的那批，卡片要自己採用
    const signal = (id: number) => ({ id, signal_type: "spike", acknowledged: false });
    // requestSeq：父層送出這一批的先後（nextRequestSeq）。卡片只採用比自己快取裡晚送出的
    const batch = (count: number, label: string, requestSeq: number) => ({
      badges: [{ type: "trending", label }],
      signals: Array.from({ length: count }, (_, i) => signal(i + 1)),
      requestSeq,
    });

    function wrapperFor(client: QueryClient) {
      return ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children);
    }

    it("shows a newer batch the parent hands over", async () => {
      // 兩批都在卡片掛上之前送出（第二批掛上時還在途中）：由 initialData 建立的那份要記第一批的先後，
      // 不能在建立查詢時另取號，否則第二批會被當成比卡片的資料舊
      const firstSent = nextRequestSeq();
      const secondSent = nextRequestSeq();
      const { result, rerender } = renderHook(
        ({ preloaded }) => useRepoCardData(42, preloaded as never, true),
        { wrapper: createWrapper(), initialProps: { preloaded: batch(1, "old", firstSent) } }
      );
      expect(result.current.activeSignalCount).toBe(1);

      rerender({ preloaded: batch(3, "new", secondSent) });

      await waitFor(() => expect(result.current.activeSignalCount).toBe(3));
      expect(result.current.badges).toEqual([{ type: "trending", label: "new" }]);
    });

    it("shows the parent's batch when the card mounts again", async () => {
      // 離開追蹤清單再回來：卡片的查詢還在快取裡（gcTime 30 分鐘），父層重抓的是新的
      const client = createTestQueryClient();
      client.setDefaultOptions({
        queries: { ...client.getDefaultOptions().queries, gcTime: Infinity },
      });
      const first = renderHook(
        () => useRepoCardData(42, batch(1, "old", nextRequestSeq()) as never, true),
        { wrapper: wrapperFor(client) }
      );
      expect(first.result.current.activeSignalCount).toBe(1);
      first.unmount();

      const again = renderHook(
        () => useRepoCardData(42, batch(3, "new", nextRequestSeq()) as never, true),
        { wrapper: wrapperFor(client) }
      );

      await waitFor(() => expect(again.result.current.activeSignalCount).toBe(3));
      expect(again.result.current.badges).toEqual([{ type: "trending", label: "new" }]);
    });

    it("does not let an older batch replace what the card read itself", async () => {
      // 批次失敗、卡片改走自己抓（deferToBatch 變 false）：先送出的那批晚回來，不能蓋掉卡片自己讀到的新結果
      mockGetBadges.mockResolvedValue({ badges: [] } as never);
      mockGetSignals.mockResolvedValue({ signals: [signal(1), signal(2), signal(3)] } as never);
      const sentEarlier = nextRequestSeq();
      const { result, rerender } = renderHook(
        ({ preloaded, defer }) => useRepoCardData(42, preloaded as never, defer),
        {
          wrapper: createWrapper(),
          initialProps: { preloaded: undefined as unknown, defer: false },
        }
      );
      await waitFor(() => expect(result.current.activeSignalCount).toBe(3));

      rerender({ preloaded: batch(1, "old", sentEarlier), defer: false });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });

      expect(result.current.activeSignalCount).toBe(3);
      expect(result.current.badges).toEqual([]);
    });

    it("does not let the card's own earlier request replace a newer batch", async () => {
      // 卡片自己抓到一半時批次恢復、送出新的一批：新的一批先到，卡片那次（先送出的）晚回來不能蓋掉它
      let answerOwnBadges: (value: unknown) => void = () => {};
      let answerOwnSignals: (value: unknown) => void = () => {};
      mockGetBadges.mockReturnValue(
        new Promise((resolve) => {
          answerOwnBadges = resolve;
        }) as never
      );
      mockGetSignals.mockReturnValue(
        new Promise((resolve) => {
          answerOwnSignals = resolve;
        }) as never
      );
      const { result, rerender } = renderHook(
        ({ preloaded, defer }) => useRepoCardData(42, preloaded as never, defer),
        {
          wrapper: createWrapper(),
          initialProps: { preloaded: undefined as unknown, defer: false },
        }
      );
      await waitFor(() => {
        expect(mockGetBadges).toHaveBeenCalledTimes(1);
        expect(mockGetSignals).toHaveBeenCalledTimes(1);
      });

      rerender({ preloaded: batch(1, "new", nextRequestSeq()), defer: true });
      await waitFor(() => expect(result.current.activeSignalCount).toBe(1));

      await act(async () => {
        answerOwnBadges({ badges: [{ type: "trending", label: "own" }] });
        answerOwnSignals({ signals: [signal(1), signal(2), signal(3)] });
        await new Promise((r) => setTimeout(r, 20));
      });

      expect(result.current.activeSignalCount).toBe(1);
      expect(result.current.badges).toEqual([{ type: "trending", label: "new" }]);
    });
  });
});
