/**
 * InterestsSection 測試：列表渲染、新增、移除。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { InterestsSection } from "../InterestsSection";
import { createTestQueryClient, queryKeys } from "../../../lib/react-query";
import * as apiClient from "../../../api/client";

vi.mock("../../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/client")>();
  return {
    ...actual,
    getInterests: vi.fn(),
    getExclusions: vi.fn(),
    createInterest: vi.fn(),
    deleteInterest: vi.fn(),
  };
});

function renderSection(onToast = vi.fn()) {
  const client = createTestQueryClient();
  return {
    onToast,
    client,
    ...render(
      <QueryClientProvider client={client}>
        <InterestsSection onToast={onToast} />
      </QueryClientProvider>
    ),
  };
}

describe("InterestsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.getInterests).mockResolvedValue({
      interests: [{ id: 1, term: "tauri", kind: "topic", weight: 3 }],
    });
    vi.mocked(apiClient.getExclusions).mockResolvedValue({
      exclusions: [{ id: 1, term: "awesome" }],
    });
  });

  it("renders interests and exclusions", async () => {
    renderSection();
    expect(await screen.findByText("tauri")).toBeInTheDocument();
    expect(await screen.findByText("awesome")).toBeInTheDocument();
  });

  it("adds an interest via form and shows a success toast", async () => {
    vi.mocked(apiClient.createInterest).mockResolvedValue({
      id: 2,
      term: "rust",
      kind: "language",
      weight: 2,
    });
    const { onToast } = renderSection();
    await screen.findByText("tauri");
    fireEvent.change(screen.getByTestId("interest-term-input"), { target: { value: "rust" } });
    fireEvent.click(screen.getByTestId("interest-add-btn"));
    await waitFor(() => expect(apiClient.createInterest).toHaveBeenCalled());
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("Interest added", "success"));
    expect(onToast).not.toHaveBeenCalledWith(expect.any(String), "error");
  });

  it("surfaces the server's reason (not a generic message) when create fails", async () => {
    // 泛用「操作失敗」跟斷網長得一模一樣，使用者不知道自己哪裡輸入錯了；
    // 伺服器的 422 detail（例如「詞正規化後太短」）必須傳到 toast。
    vi.mocked(apiClient.createInterest).mockRejectedValue(new Error("duplicate"));
    const { onToast } = renderSection();
    await screen.findByText("tauri");
    fireEvent.change(screen.getByTestId("interest-term-input"), { target: { value: "rust" } });
    fireEvent.click(screen.getByTestId("interest-add-btn"));
    await waitFor(() => expect(apiClient.createInterest).toHaveBeenCalled());
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("duplicate", "error"));
    expect(onToast).not.toHaveBeenCalledWith(expect.any(String), "success");
  });

  it("removes an interest and shows a success toast", async () => {
    vi.mocked(apiClient.deleteInterest).mockResolvedValue(undefined);
    const { onToast } = renderSection();
    await screen.findByText("tauri");
    fireEvent.click(screen.getByTestId("interest-remove-1"));
    await waitFor(() => expect(apiClient.deleteInterest).toHaveBeenCalledWith(1));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("Interest removed", "success"));
    expect(onToast).not.toHaveBeenCalledWith(expect.any(String), "error");
  });

  it("surfaces the server's reason (not a generic message) when remove fails", async () => {
    vi.mocked(apiClient.deleteInterest).mockRejectedValue(new Error("network error"));
    const { onToast } = renderSection();
    await screen.findByText("tauri");
    fireEvent.click(screen.getByTestId("interest-remove-1"));
    await waitFor(() => expect(apiClient.deleteInterest).toHaveBeenCalledWith(1));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("network error", "error"));
    expect(onToast).not.toHaveBeenCalledWith(expect.any(String), "success");
  });

  it("says the interests failed to load instead of asking the user to add some", async () => {
    // 讀不到時說「尚無興趣項目，新增 3–5 個」，使用者會以為清單不見了而重加一遍
    vi.mocked(apiClient.getInterests).mockRejectedValue(new Error("boom"));
    renderSection();

    expect(await screen.findByTestId("interests-load-error")).toHaveTextContent(
      "Couldn't load your interests."
    );
    expect(screen.queryByText(/No interests yet/)).not.toBeInTheDocument();
    // 排除清單讀到了，照樣列出
    expect(await screen.findByText("awesome")).toBeInTheDocument();
  });

  it("says the excluded terms failed to load instead of showing none", async () => {
    // 整塊不見的話看起來就是「沒有排除任何詞」
    vi.mocked(apiClient.getExclusions).mockRejectedValue(new Error("boom"));
    renderSection();

    expect(await screen.findByTestId("exclusions-load-error")).toHaveTextContent(
      "Couldn't load the excluded terms."
    );
    expect(await screen.findByText("tauri")).toBeInTheDocument();
    expect(screen.queryByTestId("interests-load-error")).not.toBeInTheDocument();
  });

  it("loads the interests again when retry is pressed", async () => {
    vi.mocked(apiClient.getInterests).mockRejectedValueOnce(new Error("boom"));
    renderSection();
    const error = await screen.findByTestId("interests-load-error");

    fireEvent.click(within(error).getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("tauri")).toBeInTheDocument();
    expect(screen.queryByTestId("interests-load-error")).not.toBeInTheDocument();
  });

  it("does not ask the user to add interests while the queries are paused", async () => {
    onlineManager.setOnline(false);
    try {
      renderSection();
      // 等一拍：React Query 以 setTimeout(0) 才通知元件，馬上斷言「沒出現」會空過
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

      expect(apiClient.getInterests).not.toHaveBeenCalled();
      expect(screen.queryByText(/No interests yet/)).not.toBeInTheDocument();
      // 還不知道清單內容時整塊是骨架，表單也還沒出現
      expect(screen.getByTestId("interests-section").querySelector(".skeleton")).not.toBeNull();
      expect(screen.queryByTestId("interest-term-input")).not.toBeInTheDocument();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("does not ask the user to add interests when reloading an empty list fails", async () => {
    // 上一次讀到的是空清單，不代表現在還是空的
    vi.mocked(apiClient.getInterests).mockResolvedValue({ interests: [] });
    const { client } = renderSection();
    expect(await screen.findByText(/No interests yet/)).toBeInTheDocument();

    vi.mocked(apiClient.getInterests).mockRejectedValue(new Error("boom"));
    void client.invalidateQueries({ queryKey: queryKeys.interests.list() });

    expect(await screen.findByTestId("interests-load-error")).toBeInTheDocument();
    expect(screen.queryByText(/No interests yet/)).not.toBeInTheDocument();
  });
});
