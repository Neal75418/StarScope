/**
 * lastLoadFailed 的單元測試：用真的 QueryClient 走過每一種讀取結果。
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { lastLoadFailed, loadInProgress } from "../react-query";

interface Pending {
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
}

/** queryFn 每被呼叫一次就多一筆待決的請求，由測試決定它何時成功或失敗 */
function setup() {
  const requests: Pending[] = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    () => {
      const query = useQuery({
        queryKey: ["probe"],
        queryFn: () =>
          new Promise<string>((resolve, reject) => {
            requests.push({ resolve, reject });
          }),
      });
      // React Query 只在 render 當下讀過的欄位改變時才重新渲染：測試要看的欄位都在這裡讀出來
      return {
        failed: lastLoadFailed(query),
        inProgress: loadInProgress(query),
        data: query.data,
        isError: query.isError,
        isFetching: query.isFetching,
        fetchStatus: query.fetchStatus,
        refetch: query.refetch,
      };
    },
    { wrapper }
  );
  return { ...view, requests };
}

async function settle(action: () => void) {
  await act(async () => {
    action();
    await Promise.resolve();
  });
}

describe("lastLoadFailed", () => {
  it("is false while the first load is still running", async () => {
    const { result, requests } = setup();
    await waitFor(() => expect(requests).toHaveLength(1));

    expect(result.current.failed).toBe(false);
  });

  it("is true once the first load fails", async () => {
    const { result, requests } = setup();
    await waitFor(() => expect(requests).toHaveLength(1));

    await settle(() => requests[0].reject(new Error("boom")));

    await waitFor(() => expect(result.current.failed).toBe(true));
  });

  it("stays true while a retry is running and there is still no data", async () => {
    const { result, requests } = setup();
    await waitFor(() => expect(requests).toHaveLength(1));
    await settle(() => requests[0].reject(new Error("boom")));
    await waitFor(() => expect(result.current.isError).toBe(true));

    await settle(() => void result.current.refetch());
    await waitFor(() => expect(requests).toHaveLength(2));

    // React Query 在這時已經把 error 清掉、狀態改回 pending——只看 isError 的話錯誤訊息會消失
    expect(result.current.isError).toBe(false);
    expect(result.current.isFetching).toBe(true);
    expect(result.current.failed).toBe(true);
  });

  it("turns false once the retry succeeds", async () => {
    const { result, requests } = setup();
    await waitFor(() => expect(requests).toHaveLength(1));
    await settle(() => requests[0].reject(new Error("boom")));
    await waitFor(() => expect(result.current.failed).toBe(true));
    await settle(() => void result.current.refetch());
    await waitFor(() => expect(requests).toHaveLength(2));

    await settle(() => requests[1].resolve("ok"));

    await waitFor(() => expect(result.current.data).toBe("ok"));
    expect(result.current.failed).toBe(false);
  });

  it("is true when a reload fails after data was loaded, and stays true while reloading again", async () => {
    const { result, requests } = setup();
    await waitFor(() => expect(requests).toHaveLength(1));
    await settle(() => requests[0].resolve("first"));
    await waitFor(() => expect(result.current.data).toBe("first"));
    expect(result.current.failed).toBe(false);

    await settle(() => void result.current.refetch());
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(result.current.failed).toBe(false);
    await settle(() => requests[1].reject(new Error("boom")));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.data).toBe("first");

    await settle(() => void result.current.refetch());
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(result.current.isFetching).toBe(true);
    expect(result.current.failed).toBe(true);

    await settle(() => requests[2].resolve("second"));
    await waitFor(() => expect(result.current.data).toBe("second"));
    expect(result.current.failed).toBe(false);
  });

  it("is true when a reload fails in the same millisecond the data arrived", async () => {
    // 兩個時間相等時只能靠 isError 分辨；mock 的請求常常同一毫秒就回來
    const now = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const { result, requests } = setup();
      await waitFor(() => expect(requests).toHaveLength(1));
      await settle(() => requests[0].resolve("first"));
      await waitFor(() => expect(result.current.data).toBe("first"));

      await settle(() => void result.current.refetch());
      await waitFor(() => expect(requests).toHaveLength(2));
      await settle(() => requests[1].reject(new Error("boom")));

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.failed).toBe(true);
    } finally {
      now.mockRestore();
    }
  });

  it("turns false after a successful retry even when the clock was set back in between", async () => {
    // 系統時間不保證只增不減（手動調時間、NTP 校正）：成功的那次時間比失敗的那次早，也還是成功
    let clock = 1_700_000_000_000;
    const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
    try {
      const { result, requests } = setup();
      await waitFor(() => expect(requests).toHaveLength(1));
      await settle(() => requests[0].reject(new Error("boom")));
      await waitFor(() => expect(result.current.failed).toBe(true));

      clock -= 5 * 60_000;
      await settle(() => void result.current.refetch());
      await waitFor(() => expect(requests).toHaveLength(2));
      await settle(() => requests[1].resolve("ok"));

      await waitFor(() => expect(result.current.data).toBe("ok"));
      expect(result.current.failed).toBe(false);
    } finally {
      now.mockRestore();
    }
  });

  it("is false while the query is paused before anything was loaded", async () => {
    onlineManager.setOnline(false);
    try {
      const { result, requests } = setup();
      await waitFor(() => expect(result.current.fetchStatus).toBe("paused"));

      expect(requests).toHaveLength(0);
      expect(result.current.failed).toBe(false);
    } finally {
      onlineManager.setOnline(true);
    }
  });
});

describe("loadInProgress", () => {
  it("is true while a load is running and false once it has settled", async () => {
    const { result, requests } = setup();
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(result.current.inProgress).toBe(true);

    await settle(() => requests[0].resolve("ok"));

    await waitFor(() => expect(result.current.data).toBe("ok"));
    expect(result.current.inProgress).toBe(false);
  });

  it("is true while a retry can only wait for the connection to come back", async () => {
    // 斷線時按重試：讀取是暫停的（isFetching 為 false），連上後會自己接著讀
    const { result, requests } = setup();
    await waitFor(() => expect(requests).toHaveLength(1));
    await settle(() => requests[0].reject(new Error("boom")));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.inProgress).toBe(false);

    onlineManager.setOnline(false);
    try {
      await settle(() => void result.current.refetch());

      await waitFor(() => expect(result.current.fetchStatus).toBe("paused"));
      expect(result.current.isFetching).toBe(false);
      expect(result.current.inProgress).toBe(true);
      expect(result.current.failed).toBe(true);
    } finally {
      onlineManager.setOnline(true);
    }
  });
});
