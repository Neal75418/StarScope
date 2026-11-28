/**
 * 批次載入接到卡片：真的 useWindowedBatchRepoData 接真的 useRepoCardData（參數跟 RepoList／RepoGrid 傳的一樣）。
 * hook 自己的測試只驗到 dataMap；卡片顯示的是它自己那份查詢的資料，dataMap 換了不代表卡片會變。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "../../lib/react-query";
import { getContextBadgesBatch, getRepoSignalsBatch } from "../../api/client";
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

vi.mock("../../contexts/WatchlistContext", () => ({
  useWatchlistActions: () => ({ showToast: vi.fn() }),
}));

const ids = [1];

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

function Card({ version }: { version: number }) {
  const { dataMap, batchOwnsData } = useWindowedBatchRepoData(ids, {
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
});
