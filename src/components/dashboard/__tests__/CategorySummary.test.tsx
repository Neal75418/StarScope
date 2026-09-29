/**
 * CategorySummary 測試：空狀態必須緊湊且給出路（CTA），
 * 不能是一片撐滿整欄的空白卡片。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { CategorySummary } from "../CategorySummary";
import { createTestQueryClient, queryKeys } from "../../../lib/react-query";
import { getCategoryTree } from "../../../api/client";

vi.mock("../../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/client")>();
  return { ...actual, getCategoryTree: vi.fn() };
});

const mockNavigateTo = vi.fn();
vi.mock("../../../contexts/NavigationContext", () => ({
  useNavigation: () => ({ navigateTo: mockNavigateTo }),
}));

function renderWithClient(ui: ReactNode, client = createTestQueryClient()) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

// 正式版的快取設定：5 分鐘內視為新鮮。測試用 client 的 staleTime 是 0，
// 「新鮮期內也要重讀」那類斷言在它上面分不出差別
function freshWindowClient() {
  return new QueryClient({ defaultOptions: { queries: { staleTime: 5 * 60 * 1000 } } });
}

const AI = { id: 1, name: "AI", icon: "🤖", color: "#f00", repo_count: 3, children: [] };

describe("CategorySummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("空狀態：緊湊卡片（--fit）＋導去追蹤清單的 CTA", async () => {
    const user = userEvent.setup();
    vi.mocked(getCategoryTree).mockResolvedValue({ tree: [], total: 0 });

    renderWithClient(<CategorySummary />);

    const cta = await screen.findByRole("button");
    // --fit 讓空卡片不被 grid 撐到跟並排的「最近活動」等高
    expect(cta.closest(".dashboard-section")).toHaveClass("dashboard-section--fit");

    await user.click(cta);
    expect(mockNavigateTo).toHaveBeenCalledWith("watchlist");
  });

  it("有分類時正常渲染卡片，不套 --fit", async () => {
    vi.mocked(getCategoryTree).mockResolvedValue({
      tree: [
        {
          id: 1,
          name: "AI",
          icon: "🤖",
          color: "#f00",
          repo_count: 3,
          children: [],
        },
      ],
    } as never);

    renderWithClient(<CategorySummary />);

    expect(await screen.findByText("AI")).toBeInTheDocument();
    expect(document.querySelector(".dashboard-section--fit")).toBeNull();
  });

  it("shows the tree the Watchlist sidebar already loaded instead of keeping its own copy", () => {
    // 側欄與摘要讀同一份快取：在 Watchlist 上改過分類之後，打開 Dashboard 就是同一份
    const client = freshWindowClient();
    client.setQueryData(queryKeys.repos.categoryTree(), { tree: [AI], total: 1 });
    vi.mocked(getCategoryTree).mockReturnValue(new Promise(() => {}));

    renderWithClient(<CategorySummary />, client);

    expect(screen.getByText("AI")).toBeInTheDocument();
  });

  it("reloads every time it is opened, even within the cache's fresh window", async () => {
    // 背景的星標同步不會通知前端：不每次重讀的話，摘要會停在 5 分鐘前的數字
    const client = freshWindowClient();
    vi.mocked(getCategoryTree).mockResolvedValue({ tree: [AI], total: 1 } as never);

    const first = renderWithClient(<CategorySummary />, client);
    expect(await screen.findByText("AI")).toBeInTheDocument();
    first.unmount();
    renderWithClient(<CategorySummary />, client);

    await waitFor(() => expect(getCategoryTree).toHaveBeenCalledTimes(2));
  });

  it("keeps the cards when a reload fails", async () => {
    // 已經有資料時，一次重讀失敗不該把整格換成錯誤訊息
    const client = freshWindowClient();
    client.setQueryData(queryKeys.repos.categoryTree(), { tree: [AI], total: 1 });
    vi.mocked(getCategoryTree).mockRejectedValue(new Error("boom"));

    renderWithClient(<CategorySummary />, client);

    await waitFor(() =>
      expect(client.getQueryState(queryKeys.repos.categoryTree())?.status).toBe("error")
    );
    // React Query 以 setTimeout(0) 才通知畫面：等這一拍，畫面才是失敗之後的樣子
    await act(() => new Promise<void>((r) => setTimeout(r, 20)));
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.queryByText("Failed to load categories")).toBeNull();
  });
});
