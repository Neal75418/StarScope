/**
 * 追蹤清單的查詢不能用 undefined 蓋掉全域的 staleTime：明確傳 undefined 會蓋掉預設、變成 0，
 * 每次掛上（例如每次進比較頁）都立刻重讀。
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useReposQuery } from "../useReposQuery";
import * as apiClient from "../../api/client";

vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  getRepos: vi.fn(),
}));

describe("useReposQuery", () => {
  it("does not override the app-wide staleTime with undefined", async () => {
    vi.mocked(apiClient.getRepos).mockResolvedValue({ repos: [], total: 0 } as never);
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 5 * 60_000, retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);

    const { result } = renderHook(() => useReposQuery(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isStale).toBe(false);
  });
});
