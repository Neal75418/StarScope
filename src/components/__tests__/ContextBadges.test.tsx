/**
 * ContextBadges 元件單元測試（簡化後僅 HN）
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ReactElement } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { ContextBadges } from "../ContextBadges";
import type { ContextBadge, ContextSignal } from "../../api/client";
import { getContextSignals } from "../../api/client";
import { createTestQueryClient, invalidateTrackedRepos } from "../../lib/react-query";

// Mock the openUrl function
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

// Mock getContextSignals for expand tests
vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getContextSignals: vi.fn().mockResolvedValue({ signals: [], total: 0, repo_id: 1 }),
  };
});

const mockGetContextSignals = vi.mocked(getContextSignals);

function renderWithClient(ui: ReactElement, client: QueryClient = createTestQueryClient()) {
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

/** 跟正式環境一樣 5 分鐘內算新鮮（測試用的 client 是 0）：收起再展開會不會重讀才看得出來 */
function clientWithAppStaleTime() {
  const client = createTestQueryClient();
  client.setDefaultOptions({
    queries: { ...client.getDefaultOptions().queries, staleTime: 5 * 60 * 1000 },
  });
  return client;
}

function discussion(id: number, title: string, score: number): ContextSignal {
  return {
    id,
    signal_type: "hn",
    external_id: String(id),
    title,
    url: `https://news.ycombinator.com/item?id=${id}`,
    score,
    comment_count: 1,
    author: "pg",
    published_at: new Date().toISOString(),
    fetched_at: new Date().toISOString(),
  };
}

function answer(...signals: ContextSignal[]) {
  return { signals, total: signals.length, repo_id: 1 };
}

// React Query 用 setTimeout(0) 通知畫面：要等過它（包在 act 裡），寫進快取的結果才看得到
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });

describe("ContextBadges", () => {
  const mockHnBadge: ContextBadge = {
    type: "hn",
    label: "HN: 500 pts",
    url: "https://news.ycombinator.com/item?id=123",
    score: 500,
    is_recent: true,
  };

  const mockHnBadgeNonRecent: ContextBadge = {
    type: "hn",
    label: "HN: 200 pts",
    url: "https://news.ycombinator.com/item?id=456",
    score: 200,
    is_recent: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // mockReset：clearAllMocks 不清 mockResolvedValueOnce 排好的回應，前一條沒用完的會漏到下一條
    mockGetContextSignals.mockReset();
    mockGetContextSignals.mockResolvedValue({ signals: [], total: 0, repo_id: 1 });
  });

  it("returns null when badges array is empty", () => {
    const { container } = renderWithClient(<ContextBadges badges={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders HN badge with icon, label and parsed value", () => {
    renderWithClient(<ContextBadges badges={[mockHnBadge]} />);

    // Icon and "HN" label
    expect(screen.getByText("🔶")).toBeInTheDocument();
    expect(screen.getByText("HN")).toBeInTheDocument();
    // Parsed value from "HN: 500 pts"
    expect(screen.getByText("500")).toBeInTheDocument();

    const button = screen.getByRole("button");
    expect(button).toBeInTheDocument();
  });

  it("renders multiple HN badges", () => {
    renderWithClient(<ContextBadges badges={[mockHnBadge, mockHnBadgeNonRecent]} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
  });

  it("applies recent class to recent badges", () => {
    renderWithClient(<ContextBadges badges={[mockHnBadge]} />);

    const button = screen.getByRole("button");
    expect(button).toHaveClass("recent");
  });

  it("does not apply recent class to non-recent badges", () => {
    renderWithClient(<ContextBadges badges={[mockHnBadgeNonRecent]} />);

    const button = screen.getByRole("button");
    expect(button).not.toHaveClass("recent");
  });

  it("shows expand arrow when repoId is provided", () => {
    renderWithClient(<ContextBadges badges={[mockHnBadge]} repoId={1} />);

    const button = screen.getByRole("button");
    expect(button).toHaveClass("expandable");
    expect(screen.getByText("▸")).toBeInTheDocument();
  });

  it("applies badge type class for styling", () => {
    renderWithClient(<ContextBadges badges={[mockHnBadge]} />);

    const button = screen.getByRole("button");
    expect(button).toHaveClass("context-badge-hn");
  });

  // ==================== 未覆蓋分支的新測試 ====================

  it("formatValue falls back to the full label when it contains no number", () => {
    const unknownBadge: ContextBadge = {
      type: "hn",
      label: "no-number-here",
      url: "https://example.com",
      score: null,
      is_recent: false,
    };
    renderWithClient(<ContextBadges badges={[unknownBadge]} />);
    // formatValue: label "no-number-here" doesn't match \d+ regex → returns full label
    expect(screen.getByText("no-number-here")).toBeInTheDocument();
  });

  it("does not show expand arrow when repoId is not provided", () => {
    renderWithClient(<ContextBadges badges={[mockHnBadge]} />);
    expect(screen.queryByText("▸")).not.toBeInTheDocument();
    expect(screen.queryByText("▾")).not.toBeInTheDocument();
  });

  it("toggleExpand fetches signals on first expand", async () => {
    const user = userEvent.setup();
    mockGetContextSignals.mockResolvedValueOnce({
      signals: [
        {
          id: 1,
          signal_type: "hn",
          external_id: "123",
          title: "HN Discussion",
          url: "https://news.ycombinator.com/item?id=123",
          score: 100,
          comment_count: 50,
          author: "pg",
          published_at: new Date().toISOString(),
          fetched_at: new Date().toISOString(),
        },
      ],
      total: 1,
      repo_id: 1,
    });

    renderWithClient(<ContextBadges badges={[mockHnBadge]} repoId={1} />);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(mockGetContextSignals).toHaveBeenCalledWith(1, "hn");
      expect(screen.getByText("HN Discussion")).toBeInTheDocument();
      expect(screen.getByText("▲ 100")).toBeInTheDocument();
      expect(screen.getByText("💬 50")).toBeInTheDocument();
      expect(screen.getByText("pg")).toBeInTheDocument();
    });
  });

  it("changes expand arrow after toggle", async () => {
    const user = userEvent.setup();

    renderWithClient(<ContextBadges badges={[mockHnBadge]} repoId={1} />);
    // Initially collapsed
    expect(screen.getByText("▸")).toBeInTheDocument();
    await user.click(screen.getByRole("button"));

    // After expand
    await waitFor(() => {
      expect(screen.getByText("▾")).toBeInTheDocument();
    });
  });

  it("shows empty panel when no signals returned", async () => {
    const user = userEvent.setup();
    mockGetContextSignals.mockResolvedValueOnce({ signals: [], total: 0, repo_id: 1 });

    renderWithClient(<ContextBadges badges={[mockHnBadge]} repoId={1} />);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText("No discussions found")).toBeInTheDocument();
    });
  });

  it("shows a retry-able error state, not the empty state", async () => {
    // 讀不到與「讀到了、沒有討論」是兩個狀態：徽章明明寫著分數，點開不能說沒討論
    const user = userEvent.setup();
    mockGetContextSignals.mockRejectedValueOnce(new Error("Network error"));

    renderWithClient(<ContextBadges badges={[mockHnBadge]} repoId={1} />);
    await user.click(screen.getByRole("button", { name: /HN/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/couldn't load/i);
    });
    expect(screen.queryByText("No discussions found")).not.toBeInTheDocument();
  });

  it("retry button refetches and can recover", async () => {
    const user = userEvent.setup();
    let answerRetry: (value: unknown) => void = () => {};
    mockGetContextSignals.mockRejectedValueOnce(new Error("Network error")).mockReturnValueOnce(
      new Promise((resolve) => {
        answerRetry = resolve;
      }) as never
    );

    renderWithClient(<ContextBadges badges={[mockHnBadge]} repoId={1} />);
    await user.click(screen.getByRole("button", { name: /HN/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Retry" }));
    // 重試中說明與按鈕都留著（焦點不離開），不整塊換成載入中
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Retrying…" })).toBeInTheDocument()
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await act(async () => {
      answerRetry({ signals: [], total: 0, repo_id: 1 });
    });
    // 重試成功後才是真正的空狀態
    await waitFor(() => {
      expect(screen.getByText("No discussions found")).toBeInTheDocument();
    });
    expect(mockGetContextSignals).toHaveBeenCalledTimes(2);
  });

  it("collapse and re-expand also retries after a failure", async () => {
    // 讀不到時沒有資料、算過期：收起再展開會重讀
    const user = userEvent.setup();
    mockGetContextSignals
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ signals: [], total: 0, repo_id: 1 });

    renderWithClient(<ContextBadges badges={[mockHnBadge]} repoId={1} />);
    const badge = screen.getByRole("button", { name: /HN/i });
    await user.click(badge);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    await user.click(badge); // 收起
    await user.click(badge); // 再展開 → 自動重打
    await waitFor(() => {
      expect(screen.getByText("No discussions found")).toBeInTheDocument();
    });
  });

  it("does not re-fetch on re-expand when nothing was re-read", async () => {
    const user = userEvent.setup();
    mockGetContextSignals.mockResolvedValue({ signals: [], total: 0, repo_id: 1 });

    renderWithClient(<ContextBadges badges={[mockHnBadge]} repoId={1} />, clientWithAppStaleTime());
    // First click: expand (fetches)
    await user.click(screen.getByRole("button"));
    await waitFor(() => expect(mockGetContextSignals).toHaveBeenCalledTimes(1));

    // Second click: collapse
    await user.click(screen.getByRole("button"));
    // Third click: expand again：5 分鐘內、追蹤清單也沒重讀過，用讀過的那份
    await user.click(screen.getByRole("button"));
    await settle();
    expect(mockGetContextSignals).toHaveBeenCalledTimes(1);
  });

  describe("跟著追蹤清單重讀", () => {
    // 背景寫入 HN（useBackgroundStarSync 看到情境訊號的寫入時間變了）、抓取、全部重新整理都經過 invalidateTrackedRepos：
    // 徽章分數會跟著變，展開的列表也要跟

    it("re-reads the open list when the tracked list is re-read", async () => {
      const user = userEvent.setup();
      mockGetContextSignals
        .mockResolvedValueOnce(answer(discussion(1, "First read", 100)))
        .mockResolvedValueOnce(
          answer(discussion(1, "First read", 180), discussion(2, "New post", 20))
        );
      const { client } = renderWithClient(
        <ContextBadges badges={[mockHnBadge]} repoId={1} />,
        clientWithAppStaleTime()
      );
      await user.click(screen.getByRole("button", { name: /HN/i }));
      await waitFor(() => expect(screen.getByText("▲ 100")).toBeInTheDocument());

      await act(async () => {
        invalidateTrackedRepos(client);
      });

      await waitFor(() => expect(screen.getByText("▲ 180")).toBeInTheDocument());
      expect(screen.getByText("New post")).toBeInTheDocument();
    });

    it("re-reads on the next expand when the tracked list was re-read while it was closed", async () => {
      const user = userEvent.setup();
      let answerSecondRead: (value: unknown) => void = () => {};
      mockGetContextSignals
        .mockResolvedValueOnce(answer(discussion(1, "First read", 100)))
        .mockReturnValueOnce(
          new Promise((resolve) => {
            answerSecondRead = resolve;
          }) as never
        );
      const { client } = renderWithClient(
        <ContextBadges badges={[mockHnBadge]} repoId={1} />,
        clientWithAppStaleTime()
      );
      const badge = screen.getByRole("button", { name: /HN/i });
      await user.click(badge);
      await waitFor(() => expect(screen.getByText("▲ 100")).toBeInTheDocument());
      await user.click(badge); // 收起

      await act(async () => {
        invalidateTrackedRepos(client);
      });
      await settle();
      // 收著的時候不另外發請求，下次展開才重讀
      expect(mockGetContextSignals).toHaveBeenCalledTimes(1);

      await user.click(badge);
      await waitFor(() => expect(mockGetContextSignals).toHaveBeenCalledTimes(2));
      // 重讀還沒回來時先顯示讀過的那份，不整塊換成載入中
      expect(screen.getByText("▲ 100")).toBeInTheDocument();

      await act(async () => {
        answerSecondRead(answer(discussion(1, "First read", 150)));
      });
      await waitFor(() => expect(screen.getByText("▲ 150")).toBeInTheDocument());
    });

    it("keeps the list and says it didn't update when a re-read fails", async () => {
      const user = userEvent.setup();
      let answerRetry: (value: unknown) => void = () => {};
      mockGetContextSignals
        .mockResolvedValueOnce(answer(discussion(1, "First read", 100)))
        .mockRejectedValueOnce(new Error("Server error"))
        .mockReturnValueOnce(
          new Promise((resolve) => {
            answerRetry = resolve;
          }) as never
        );
      const { client } = renderWithClient(
        <ContextBadges badges={[mockHnBadge]} repoId={1} />,
        clientWithAppStaleTime()
      );
      await user.click(screen.getByRole("button", { name: /HN/i }));
      await waitFor(() => expect(screen.getByText("▲ 100")).toBeInTheDocument());

      await act(async () => {
        invalidateTrackedRepos(client);
      });

      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't update/i));
      expect(screen.getByText("▲ 100")).toBeInTheDocument();

      // 這一列的重試：重試中說明與按鈕留著、列表也留著；成功後說明消失、換成新的
      await user.click(screen.getByRole("button", { name: "Retry" }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Retrying…" })).toBeInTheDocument()
      );
      expect(screen.getByRole("alert")).toHaveTextContent(/couldn't update/i);
      expect(screen.getByText("▲ 100")).toBeInTheDocument();

      await act(async () => {
        answerRetry(answer(discussion(1, "First read", 200)));
      });
      await waitFor(() => expect(screen.getByText("▲ 200")).toBeInTheDocument());
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("keeps only the read sent last when a re-read interrupts one still out", async () => {
      // 第一次讀還沒回來就遇到追蹤清單重讀：會再送一次，先送出的那次晚到也寫不進快取
      const user = userEvent.setup();
      let answerFirst: (value: unknown) => void = () => {};
      let answerSecond: (value: unknown) => void = () => {};
      mockGetContextSignals
        .mockReturnValueOnce(
          new Promise((resolve) => {
            answerFirst = resolve;
          }) as never
        )
        .mockReturnValueOnce(
          new Promise((resolve) => {
            answerSecond = resolve;
          }) as never
        );
      const { client } = renderWithClient(
        <ContextBadges badges={[mockHnBadge]} repoId={1} />,
        clientWithAppStaleTime()
      );
      await user.click(screen.getByRole("button", { name: /HN/i }));
      await waitFor(() => expect(mockGetContextSignals).toHaveBeenCalledTimes(1));

      await act(async () => {
        invalidateTrackedRepos(client);
      });
      await waitFor(() => expect(mockGetContextSignals).toHaveBeenCalledTimes(2));

      await act(async () => {
        answerSecond(answer(discussion(1, "First read", 150)));
      });
      await waitFor(() => expect(screen.getByText("▲ 150")).toBeInTheDocument());

      await act(async () => {
        answerFirst(answer(discussion(1, "First read", 100)));
      });
      await settle();
      expect(screen.getByText("▲ 150")).toBeInTheDocument();
    });

    it("stops re-reading once the badges are gone and the panel is no longer shown", async () => {
      const user = userEvent.setup();
      mockGetContextSignals.mockResolvedValue(answer(discussion(1, "First read", 100)));
      const client = clientWithAppStaleTime();
      const { rerender } = renderWithClient(
        <ContextBadges badges={[mockHnBadge]} repoId={1} />,
        client
      );
      await user.click(screen.getByRole("button", { name: /HN/i }));
      await waitFor(() => expect(screen.getByText("▲ 100")).toBeInTheDocument());

      rerender(
        <QueryClientProvider client={client}>
          <ContextBadges badges={[]} repoId={1} />
        </QueryClientProvider>
      );
      await act(async () => {
        invalidateTrackedRepos(client);
      });
      await settle();

      expect(mockGetContextSignals).toHaveBeenCalledTimes(1);
    });
  });

  it("does not add React Query's retry on top of the API's own retries", async () => {
    // apiCall 對 GET 已經重試過：正式環境的 client 預設 retry 1，元件不關掉的話讀不到要晚一倍才出現
    const user = userEvent.setup();
    mockGetContextSignals.mockRejectedValue(new Error("Server error"));
    const client = createTestQueryClient();
    client.setDefaultOptions({
      queries: { ...client.getDefaultOptions().queries, retry: 1, retryDelay: 0 },
    });
    renderWithClient(<ContextBadges badges={[mockHnBadge]} repoId={1} />, client);

    await user.click(screen.getByRole("button", { name: /HN/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    await settle();

    expect(mockGetContextSignals).toHaveBeenCalledTimes(1);
  });

  it("toggleExpand does nothing when repoId is undefined", async () => {
    const user = userEvent.setup();
    renderWithClient(<ContextBadges badges={[mockHnBadge]} />);
    // Badge without repoId has no onClick
    const button = screen.getByRole("button");
    await user.click(button);
    expect(mockGetContextSignals).not.toHaveBeenCalled();
  });

  it("renders signal with null metadata fields", async () => {
    const user = userEvent.setup();
    mockGetContextSignals.mockResolvedValueOnce({
      signals: [
        {
          id: 2,
          signal_type: "hn",
          external_id: "456",
          title: "",
          url: "https://news.ycombinator.com/item?id=456",
          score: null,
          comment_count: null,
          author: null,
          published_at: null,
          fetched_at: new Date().toISOString(),
        },
      ],
      total: 1,
      repo_id: 1,
    });

    renderWithClient(<ContextBadges badges={[mockHnBadge]} repoId={1} />);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      // Empty title falls back to "Untitled"
      expect(screen.getByText("Untitled")).toBeInTheDocument();
      // Null score/comment_count/author/published_at should not render
      expect(screen.queryByText(/▲/)).not.toBeInTheDocument();
      expect(screen.queryByText(/💬/)).not.toBeInTheDocument();
    });
  });

  it("renders time ago for signals with published_at", async () => {
    const user = userEvent.setup();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    mockGetContextSignals.mockResolvedValueOnce({
      signals: [
        {
          id: 3,
          signal_type: "hn",
          external_id: "789",
          title: "Old Discussion",
          url: "https://news.ycombinator.com/item?id=789",
          score: 42,
          comment_count: null,
          author: null,
          published_at: twoDaysAgo,
          fetched_at: new Date().toISOString(),
        },
      ],
      total: 1,
      repo_id: 1,
    });

    renderWithClient(<ContextBadges badges={[mockHnBadge]} repoId={1} />);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText("2d")).toBeInTheDocument();
    });
  });

  it("renders 'today' for signal published today", async () => {
    const user = userEvent.setup();
    mockGetContextSignals.mockResolvedValueOnce({
      signals: [
        {
          id: 4,
          signal_type: "hn",
          external_id: "101",
          title: "Today Discussion",
          url: "https://example.com",
          score: 10,
          comment_count: 5,
          author: "user1",
          published_at: new Date().toISOString(),
          fetched_at: new Date().toISOString(),
        },
      ],
      total: 1,
      repo_id: 1,
    });

    renderWithClient(<ContextBadges badges={[mockHnBadge]} repoId={1} />);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText("Just now")).toBeInTheDocument();
    });
  });

  it("renders '1d ago' for signal from yesterday", async () => {
    const user = userEvent.setup();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    mockGetContextSignals.mockResolvedValueOnce({
      signals: [
        {
          id: 5,
          signal_type: "hn",
          external_id: "102",
          title: "Yesterday",
          url: "https://example.com",
          score: null,
          comment_count: null,
          author: null,
          published_at: yesterday,
          fetched_at: new Date().toISOString(),
        },
      ],
      total: 1,
      repo_id: 1,
    });

    renderWithClient(<ContextBadges badges={[mockHnBadge]} repoId={1} />);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText("1d")).toBeInTheDocument();
    });
  });

  it("renders months ago for older signals", async () => {
    const user = userEvent.setup();
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    mockGetContextSignals.mockResolvedValueOnce({
      signals: [
        {
          id: 6,
          signal_type: "hn",
          external_id: "103",
          title: "Old Signal",
          url: "https://example.com",
          score: null,
          comment_count: null,
          author: null,
          published_at: sixtyDaysAgo,
          fetched_at: new Date().toISOString(),
        },
      ],
      total: 1,
      repo_id: 1,
    });

    renderWithClient(<ContextBadges badges={[mockHnBadge]} repoId={1} />);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText("2mo")).toBeInTheDocument();
    });
  });

  it("renders years ago for very old signals", async () => {
    const user = userEvent.setup();
    const twoYearsAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    mockGetContextSignals.mockResolvedValueOnce({
      signals: [
        {
          id: 7,
          signal_type: "hn",
          external_id: "104",
          title: "Ancient Signal",
          url: "https://example.com",
          score: null,
          comment_count: null,
          author: null,
          published_at: twoYearsAgo,
          fetched_at: new Date().toISOString(),
        },
      ],
      total: 1,
      repo_id: 1,
    });

    renderWithClient(<ContextBadges badges={[mockHnBadge]} repoId={1} />);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText("1y")).toBeInTheDocument();
    });
  });

  it("re-expanding while the first read is still out does not send another one", async () => {
    // 展開→收起→再展開時沿用還在途的那次，不另外送；回來的就是畫面上的
    const user = userEvent.setup();
    let answerRead: (value: unknown) => void = () => {};
    mockGetContextSignals.mockReturnValueOnce(
      new Promise((resolve) => {
        answerRead = resolve;
      }) as never
    );

    renderWithClient(<ContextBadges badges={[mockHnBadge]} repoId={1} />);
    const badge = screen.getAllByRole("button")[0];

    await user.click(badge); // 展開 → 請求起飛
    await user.click(badge); // 收合（仍在途）
    await user.click(badge); // 再展開
    await settle();
    expect(mockGetContextSignals).toHaveBeenCalledTimes(1);

    await act(async () => {
      answerRead(answer(discussion(9, "Fresh Discussion", 10)));
    });
    await waitFor(() => expect(screen.getByText("Fresh Discussion")).toBeInTheDocument());
  });
});
