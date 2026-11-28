/**
 * 批次載入接到卡片：真的 useWindowedBatchRepoData 接真的 useRepoCardData（參數跟 RepoList／RepoGrid 傳的一樣）。
 * hook 自己的測試只驗到 dataMap；卡片顯示的是它自己那份查詢的資料，dataMap 換了不代表卡片會變。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient, invalidateTrackedRepos } from "../../lib/react-query";
import {
  getContextBadges,
  getContextBadgesBatch,
  getRepoSignals,
  getRepoSignalsBatch,
} from "../../api/client";
import { useWindowedBatchRepoData } from "../useWindowedBatchRepoData";
import { useRepoCardData } from "../useRepoCardData";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getContextBadgesBatch: vi.fn(),
    getRepoSignalsBatch: vi.fn(),
    getContextBadges: vi.fn(),
    getRepoSignals: vi.fn(),
  };
});

const ids = [1];
const withSecond = [1, 2];

function signals(count: number) {
  return {
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
  };
}

function Card({ version, repoIds = ids }: { version: number; repoIds?: number[] }) {
  const { dataMap, batchOwnsData } = useWindowedBatchRepoData(repoIds, {
    debounceMs: 0,
    dataVersion: version,
  });
  const { activeSignalCount } = useRepoCardData(1, dataMap[1], batchOwnsData);
  return <span data-testid="active-signals">{activeSignalCount}</span>;
}

describe("卡片跟著批次重抓", () => {
  beforeEach(() => {
    vi.mocked(getContextBadgesBatch)
      .mockReset()
      .mockResolvedValue({ "1": { repo_id: 1, badges: [] } } as never);
    vi.mocked(getRepoSignalsBatch).mockReset();
    vi.mocked(getContextBadges).mockReset();
    vi.mocked(getRepoSignals).mockReset();
  });

  // 通知畫面的 setTimeout 要在 act 裡等過，寫進快取的結果才看得到
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

  it("shows the new signal count after the tracked list was read again", async () => {
    vi.mocked(getRepoSignalsBatch)
      .mockResolvedValueOnce(signals(1) as never)
      .mockResolvedValue(signals(3) as never);
    const client = createTestQueryClient();
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <Card version={1} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByTestId("active-signals")).toHaveTextContent("1"));

    rerender(
      <QueryClientProvider client={client}>
        <Card version={2} />
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByTestId("active-signals")).toHaveTextContent("3"));
  });

  it("keeps what the card read itself when a batch sent earlier arrives later", async () => {
    // 送出 repo 1 的那批還在途中，清單多了 repo 2、只含 repo 2 的那批失敗 → 卡片改走自己抓（讀到 3）；
    // 先送出的那批最後才回來（1），不能蓋掉卡片自己讀到的
    let answerFirstBatch: (value: unknown) => void = () => {};
    vi.mocked(getRepoSignalsBatch)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          answerFirstBatch = resolve;
        }) as never
      )
      .mockRejectedValueOnce(new Error("batch failed"));
    vi.mocked(getContextBadges).mockResolvedValue({ repo_id: 1, badges: [] } as never);
    vi.mocked(getRepoSignals).mockResolvedValue(signals(3)["1"] as never);
    const client = createTestQueryClient();
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <Card version={1} repoIds={ids} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(getRepoSignalsBatch).toHaveBeenCalledTimes(1));

    rerender(
      <QueryClientProvider client={client}>
        <Card version={1} repoIds={withSecond} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByTestId("active-signals")).toHaveTextContent("3"));
    expect(vi.mocked(getRepoSignalsBatch).mock.calls[1][0]).toEqual([2]);

    // 那批要等這個 act 結束才 render、寫進卡片的查詢；寫入後 React Query 用 setTimeout 通知畫面，
    // 要在下一個 act 裡等過才看得到（只等一個 act 的話改動前也會是 3，斷言空過）
    await act(async () => {
      answerFirstBatch(signals(1));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(screen.getByTestId("active-signals")).toHaveTextContent("3");
  });

  it("sends no per-card requests while the batch owns the data, also when the list is read again", async () => {
    // 批次負責時卡片不自己抓（W80 之前 200 個 repo 的格狀檢視因此發出 348 個請求）；
    // 追蹤清單重讀時卡片的查詢也只標過期，不另外發請求
    vi.mocked(getRepoSignalsBatch).mockResolvedValue(signals(2) as never);
    const client = createTestQueryClient();
    render(
      <QueryClientProvider client={client}>
        <Card version={1} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByTestId("active-signals")).toHaveTextContent("2"));

    await act(async () => {
      invalidateTrackedRepos(client);
    });
    await settle();

    expect(getContextBadges).not.toHaveBeenCalled();
    expect(getRepoSignals).not.toHaveBeenCalled();
  });

  it("sends no per-card requests for cards that left the screen either", async () => {
    // 捲出畫面的卡片查詢還留在快取裡（gcTime 30 分鐘），換過一批之後就不算 disabled：
    // 失效時只重抓畫面上的（refetchType active），這些不會一張張被個別重抓
    vi.mocked(getRepoSignalsBatch)
      .mockResolvedValueOnce(signals(1) as never)
      .mockResolvedValue(signals(2) as never);
    const client = createTestQueryClient();
    client.setDefaultOptions({
      queries: { ...client.getDefaultOptions().queries, gcTime: Infinity },
    });
    const { rerender, unmount } = render(
      <QueryClientProvider client={client}>
        <Card version={1} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByTestId("active-signals")).toHaveTextContent("1"));
    rerender(
      <QueryClientProvider client={client}>
        <Card version={2} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByTestId("active-signals")).toHaveTextContent("2"));
    unmount();

    await act(async () => {
      invalidateTrackedRepos(client);
    });
    await settle();

    expect(getContextBadges).not.toHaveBeenCalled();
    expect(getRepoSignals).not.toHaveBeenCalled();
  });

  it("reads again when the list is re-read while the card's own first request is still out", async () => {
    // 批次失敗、卡片改走自己抓，第一次還沒回來就遇到追蹤清單重讀：還沒有資料時 React Query 不中止
    // 在途的請求，只失效的話會併進這個寫入前送出的請求、停在舊值（跟分類查詢同一個陷阱）
    vi.mocked(getRepoSignalsBatch).mockRejectedValue(new Error("batch failed"));
    vi.mocked(getContextBadges).mockResolvedValue({ repo_id: 1, badges: [] } as never);
    let answerFirstRead: (value: unknown) => void = () => {};
    vi.mocked(getRepoSignals)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          answerFirstRead = resolve;
        }) as never
      )
      .mockResolvedValue(signals(7)["1"] as never);
    const client = createTestQueryClient();
    render(
      <QueryClientProvider client={client}>
        <Card version={1} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(getRepoSignals).toHaveBeenCalledTimes(1));

    await act(async () => {
      invalidateTrackedRepos(client);
    });
    await act(async () => {
      answerFirstRead(signals(2)["1"]);
    });
    await settle();

    expect(screen.getByTestId("active-signals")).toHaveTextContent("7");
    expect(getRepoSignals).toHaveBeenCalledTimes(2);
  });
});
