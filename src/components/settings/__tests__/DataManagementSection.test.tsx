/**
 * Regression tests for DataManagementSection component.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { DataManagementSection } from "../DataManagementSection";
import { createTestQueryClient, queryClient as appQueryClient } from "../../../lib/react-query";
import { STORAGE_KEYS } from "../../../constants/storage";
import { DATA_RESET_EVENT } from "../../../constants/events";
import * as apiClient from "../../../api/client";

vi.mock("../../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/client")>();
  return {
    ...actual,
    clearCache: vi.fn(),
    resetAllData: vi.fn(),
  };
});

function renderSection(onToast = vi.fn()) {
  const client = createTestQueryClient();
  return {
    onToast,
    ...render(
      <QueryClientProvider client={client}>
        <DataManagementSection onToast={onToast} />
      </QueryClientProvider>
    ),
  };
}

/** 正式版的快取設定（staleTime、gcTime），只關掉重試：測試版 client 的 gcTime 0 會讓沒人看的查詢立刻被回收，驗不到重設怎麼處理它們 */
function createAppLikeQueryClient() {
  const defaults = appQueryClient.getDefaultOptions();
  return new QueryClient({
    defaultOptions: { ...defaults, queries: { ...defaults.queries, retry: false } },
  });
}

/** 不會自己讀的查詢，畫出它現在的資料（repo 卡片的預載值就是這種：有 initialData、enabled false） */
function CachedValue({ initialData }: { initialData?: string }) {
  const { data } = useQuery({
    queryKey: ["cached-value"],
    queryFn: () => Promise.resolve("read"),
    initialData,
    enabled: false,
  });
  return <p data-testid="cached-value">{data ?? "no data"}</p>;
}

async function confirmReset(user: ReturnType<typeof userEvent.setup>) {
  const section = screen.getByTestId("data-management-section");
  await user.click(within(section).getByRole("button", { name: /Reset All|重置所有/ }));
  const dialog = await screen.findByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: /Reset All Data|重置所有資料/ }));
  await waitFor(() => {
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
}

describe("DataManagementSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps reset confirm dialog open when reset fails", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.resetAllData).mockRejectedValue(new Error("Server error"));
    const { onToast } = renderSection();

    // Open the reset confirm dialog (trigger button in the section)
    const section = screen.getByTestId("data-management-section");
    await user.click(within(section).getByRole("button", { name: /Reset All|重置所有/ }));

    // Confirm dialog should be visible — find confirm button inside the alertdialog
    const dialog = await waitFor(() => screen.getByRole("alertdialog"));
    const confirmBtn = within(dialog).getByRole("button", { name: /Reset All Data|重置所有資料/ }); // second button is confirm

    // Click confirm — reset fails
    await user.click(confirmBtn);

    // Dialog should remain open for retry
    await waitFor(() => {
      expect(onToast).toHaveBeenCalledWith(expect.any(String), "error");
    });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("closes reset confirm dialog on success", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.resetAllData).mockResolvedValue({
      status: "ok",
      deleted_repos: 5,
    });
    const { onToast } = renderSection();

    const section = screen.getByTestId("data-management-section");
    await user.click(within(section).getByRole("button", { name: /Reset All|重置所有/ }));

    const dialog = await waitFor(() => screen.getByRole("alertdialog"));
    const confirmBtn = within(dialog).getByRole("button", { name: /Reset All Data|重置所有資料/ });

    await user.click(confirmBtn);

    await waitFor(() => {
      expect(onToast).toHaveBeenCalledWith(expect.any(String), "success");
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("clears data-derived localStorage keys on reset success", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.resetAllData).mockResolvedValue({
      status: "ok",
      deleted_repos: 5,
    });

    // Pre-seed data-derived keys
    localStorage.setItem(STORAGE_KEYS.COMPARE_REPOS, JSON.stringify([1, 2]));
    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS_READ, JSON.stringify(["a"]));
    localStorage.setItem(STORAGE_KEYS.DISMISSED_RECS, JSON.stringify(["b"]));
    // Pre-seed a user preference key (should be preserved)
    localStorage.setItem(STORAGE_KEYS.THEME, "dark");

    renderSection();

    const section = screen.getByTestId("data-management-section");
    await user.click(within(section).getByRole("button", { name: /Reset All|重置所有/ }));
    const dialog = await waitFor(() => screen.getByRole("alertdialog"));
    const confirmBtn = within(dialog).getByRole("button", { name: /Reset All Data|重置所有資料/ });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    // Data-derived keys should be cleared
    expect(localStorage.getItem(STORAGE_KEYS.COMPARE_REPOS)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS_READ)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.DISMISSED_RECS)).toBeNull();
    // User preference should be preserved
    expect(localStorage.getItem(STORAGE_KEYS.THEME)).toBe("dark");
  });

  it("dispatches data-reset event on reset success", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.resetAllData).mockResolvedValue({
      status: "ok",
      deleted_repos: 5,
    });

    const eventHandler = vi.fn();
    window.addEventListener(DATA_RESET_EVENT, eventHandler);

    renderSection();

    const section = screen.getByTestId("data-management-section");
    await user.click(within(section).getByRole("button", { name: /Reset All|重置所有/ }));
    const dialog = await waitFor(() => screen.getByRole("alertdialog"));
    const confirmBtn = within(dialog).getByRole("button", { name: /Reset All Data|重置所有資料/ });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(eventHandler).toHaveBeenCalledTimes(1);
    });

    window.removeEventListener(DATA_RESET_EVENT, eventHandler);
  });

  it("drops cached data nobody is showing, so it does not come back as it was first loaded", async () => {
    // repo id 會重用：重設後新加的 repo 拿到舊 id 時，不能看到舊 repo 的預載值
    const user = userEvent.setup();
    vi.mocked(apiClient.resetAllData).mockResolvedValue({ status: "reset", deleted_repos: 1 });
    const client = createAppLikeQueryClient();
    const before = render(
      <QueryClientProvider client={client}>
        <CachedValue initialData="before reset" />
      </QueryClientProvider>
    );
    expect(screen.getByTestId("cached-value")).toHaveTextContent("before reset");
    before.unmount();

    const section = render(
      <QueryClientProvider client={client}>
        <DataManagementSection onToast={vi.fn()} />
      </QueryClientProvider>
    );
    await confirmReset(user);
    section.unmount();

    render(
      <QueryClientProvider client={client}>
        <CachedValue initialData="after reset" />
      </QueryClientProvider>
    );
    expect(screen.getByTestId("cached-value")).toHaveTextContent("after reset");
    client.clear();
  });

  it("clears data on screen even when that query does not read again by itself", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.resetAllData).mockResolvedValue({ status: "reset", deleted_repos: 1 });
    const client = createAppLikeQueryClient();
    render(
      <QueryClientProvider client={client}>
        <CachedValue />
        <DataManagementSection onToast={vi.fn()} />
      </QueryClientProvider>
    );
    act(() => {
      client.setQueryData(["cached-value"], "before reset");
    });
    expect(await screen.findByText("before reset")).toBeInTheDocument();

    await confirmReset(user);

    await waitFor(() => {
      expect(screen.getByTestId("cached-value")).toHaveTextContent("no data");
    });
    client.clear();
  });

  it("keeps counting a write that is still in progress", async () => {
    // useStarSync 用 isMutating 判斷同步還在不在跑：重設時清掉 mutation 快取的話，進行中的同步會被當成沒在跑而 reset
    const user = userEvent.setup();
    vi.mocked(apiClient.resetAllData).mockResolvedValue({ status: "reset", deleted_repos: 1 });
    const client = createAppLikeQueryClient();
    render(
      <QueryClientProvider client={client}>
        <DataManagementSection onToast={vi.fn()} />
      </QueryClientProvider>
    );
    void client
      .getMutationCache()
      .build(client, { mutationKey: ["in-progress"], mutationFn: () => new Promise(() => {}) })
      .execute(undefined);
    expect(client.isMutating({ mutationKey: ["in-progress"] })).toBe(1);

    await confirmReset(user);

    expect(client.isMutating({ mutationKey: ["in-progress"] })).toBe(1);
    client.clear();
  });
});
