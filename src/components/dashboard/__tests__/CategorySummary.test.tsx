/**
 * CategorySummary 測試：空狀態必須緊湊且給出路（CTA），
 * 不能是一片撐滿整欄的空白卡片。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { CategorySummary } from "../CategorySummary";
import { createTestQueryClient } from "../../../lib/react-query";
import { getCategoryTree } from "../../../api/client";

vi.mock("../../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/client")>();
  return { ...actual, getCategoryTree: vi.fn() };
});

const mockNavigateTo = vi.fn();
vi.mock("../../../contexts/NavigationContext", () => ({
  useNavigation: () => ({ navigateTo: mockNavigateTo }),
}));

function renderWithClient(ui: ReactNode) {
  const client = createTestQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

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
});
