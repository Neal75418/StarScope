import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, type ReactNode } from "react";
import { useDigest } from "../useDigest";
import { getDigest, markDigestSeen } from "../../api/client";
import type { DigestResponse } from "../../api/client";

vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  getDigest: vi.fn(),
  markDigestSeen: vi.fn(),
}));

const repo = { id: 1, full_name: "o/r", url: "https://github.com/o/r" };

function batch(key: string, cursorId: number): DigestResponse {
  return {
    items: [
      {
        key,
        tier: "highlight",
        kind: "release",
        repo,
        occurred_at: "2026-09-25T00:00:00+00:00",
        url: null,
        title: key,
        tags: ["security"],
      },
    ],
    other_total: 0,
    cursor: { context_signal_id: cursorId, early_signal_id: 0, triggered_alert_id: 0 },
    last_seen_at: "2026-09-22T00:00:00+00:00",
    releases_checked: true,
  };
}

function wrapper({ strict = false }: { strict?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => {
    const tree = <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    return strict ? <StrictMode>{tree}</StrictMode> : tree;
  };
}

describe("useDigest", () => {
  beforeEach(() => {
    vi.mocked(getDigest).mockReset();
    vi.mocked(markDigestSeen).mockReset();
    vi.mocked(markDigestSeen).mockImplementation(async (c) => c);
  });

  it("marks the batch it received as seen, exactly once", async () => {
    vi.mocked(getDigest).mockResolvedValue(batch("release:1", 1));

    // StrictMode 會把 effect 跑兩次：開發模式下沒有去重就會送兩次
    const { result, rerender } = renderHook(
      () => useDigest({ isFetchInProgress: false, canMarkSeen: true }),
      {
        wrapper: wrapper({ strict: true }),
      }
    );

    await waitFor(() => expect(result.current.digest).toBeDefined());
    rerender();
    await waitFor(() => expect(markDigestSeen).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(markDigestSeen).toHaveBeenCalledTimes(1);
    expect(markDigestSeen).toHaveBeenCalledWith({
      context_signal_id: 1,
      early_signal_id: 0,
      triggered_alert_id: 0,
    });
  });

  it("does not mark anything seen until the panel is actually on screen", async () => {
    // Dashboard 在載入骨架、錯誤畫面、引導卡時不渲染面板，但 hook 必須無條件呼叫
    vi.mocked(getDigest).mockResolvedValue(batch("release:1", 1));

    const { result, rerender } = renderHook(
      ({ visible }: { visible: boolean }) =>
        useDigest({ isFetchInProgress: false, canMarkSeen: visible }),
      { wrapper: wrapper(), initialProps: { visible: false } }
    );
    await waitFor(() => expect(result.current.digest).toBeDefined());
    await new Promise((r) => setTimeout(r, 20));
    expect(markDigestSeen).not.toHaveBeenCalled();

    rerender({ visible: true });

    await waitFor(() => expect(markDigestSeen).toHaveBeenCalledTimes(1));
  });

  it("does not mark anything seen when loading fails", async () => {
    vi.mocked(getDigest).mockRejectedValue(new Error("500"));

    const { result } = renderHook(
      () => useDigest({ isFetchInProgress: false, canMarkSeen: true }),
      {
        wrapper: wrapper(),
      }
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(markDigestSeen).not.toHaveBeenCalled();
  });

  it("appendNew keeps what is on screen and adds the newer items", async () => {
    vi.mocked(getDigest)
      .mockResolvedValueOnce(batch("release:1", 1))
      .mockResolvedValueOnce(batch("release:2", 2));

    const { result } = renderHook(
      () => useDigest({ isFetchInProgress: false, canMarkSeen: true }),
      {
        wrapper: wrapper(),
      }
    );
    await waitFor(() => expect(result.current.digest).toBeDefined());

    await act(() => result.current.appendNew());

    expect(result.current.digest?.items.map((i) => i.key).sort()).toEqual([
      "release:1",
      "release:2",
    ]);
    await waitFor(() =>
      expect(markDigestSeen).toHaveBeenLastCalledWith({
        context_signal_id: 2,
        early_signal_id: 0,
        triggered_alert_id: 0,
      })
    );
  });

  it("a failed append keeps the batch and says so", async () => {
    vi.mocked(getDigest)
      .mockResolvedValueOnce(batch("release:1", 1))
      .mockRejectedValueOnce(new Error("offline"));

    const { result } = renderHook(
      () => useDigest({ isFetchInProgress: false, canMarkSeen: true }),
      {
        wrapper: wrapper(),
      }
    );
    await waitFor(() => expect(result.current.digest).toBeDefined());

    await act(() => result.current.appendNew());

    expect(result.current.digest?.items.map((i) => i.key)).toEqual(["release:1"]);
    expect(result.current.appendFailed).toBe(true);
  });

  it("appends automatically when a fetch finishes", async () => {
    vi.mocked(getDigest)
      .mockResolvedValueOnce(batch("release:1", 1))
      .mockResolvedValueOnce(batch("release:2", 2));

    const { result, rerender } = renderHook(
      ({ busy }: { busy: boolean }) => useDigest({ isFetchInProgress: busy, canMarkSeen: true }),
      { wrapper: wrapper(), initialProps: { busy: false } }
    );
    await waitFor(() => expect(result.current.digest).toBeDefined());

    rerender({ busy: true });
    rerender({ busy: false });

    await waitFor(() => expect(result.current.digest?.items).toHaveLength(2));
  });

  it("does not append on the first render just because the fetch flag starts false", async () => {
    vi.mocked(getDigest).mockResolvedValue(batch("release:1", 1));

    renderHook(() => useDigest({ isFetchInProgress: false, canMarkSeen: true }), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(getDigest).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(getDigest).toHaveBeenCalledTimes(1);
  });
});
