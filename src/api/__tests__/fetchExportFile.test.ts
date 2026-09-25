/**
 * fetchExportFile：匯出改用帶 session secret 的 fetch。
 *
 * 頁面導覽式的 `<a href download>` 不帶 X-Session-Secret，正式版的 sidecar 會回 403。
 * 獨立成一個檔案，是因為要把 getSessionSecret 換成回傳固定值；放進 client.test.ts
 * 會讓那裡所有請求都開始帶 header。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchExportFile } from "../client";
import { ApiError } from "../types";
import { API_ERROR_MESSAGES } from "../../constants/api";

vi.mock("../sessionSecret", () => ({
  getSessionSecret: vi.fn().mockResolvedValue("s3cret"),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

function response(body: string, init: ResponseInit & { headers?: Record<string, string> } = {}) {
  return new Response(body, { status: 200, ...init });
}

describe("fetchExportFile", () => {
  // 一定要有大括號：箭頭函式會隱式回傳 mockReset() 的結果——mock 本身，而 vitest 把 hook
  // 回傳的函式當成 teardown，在每條測試結束後呼叫它。那一下正好會觸發測試設定的錯誤
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("帶著 session secret 取得內容，並從 Content-Disposition 取檔名", async () => {
    mockFetch.mockResolvedValue(
      response("owner,name\n", {
        headers: {
          "Content-Disposition": 'attachment; filename="starscope_watchlist_20260925.csv"',
        },
      })
    );

    const file = await fetchExportFile("http://127.0.0.1:8008/api/export/watchlist.csv");

    const [, init] = mockFetch.mock.calls[0];
    expect(new Headers(init.headers).get("X-Session-Secret")).toBe("s3cret");
    expect(file).toEqual({
      content: "owner,name\n",
      filename: "starscope_watchlist_20260925.csv",
    });
  });

  it("讀不到檔名時回 null，讓呼叫端用自己的預設檔名", async () => {
    // CORS 沒有 expose 這個 header 時，跨來源的 fetch 就是看不到它
    mockFetch.mockResolvedValue(response("{}"));

    const file = await fetchExportFile("http://127.0.0.1:8008/api/export/watchlist.json");

    expect(file.filename).toBeNull();
  });

  it("sidecar 回錯誤時拋 ApiError，而不是把錯誤內容當成匯出檔", async () => {
    mockFetch.mockResolvedValue(
      response(JSON.stringify({ detail: "Forbidden: invalid session secret" }), { status: 403 })
    );

    const error = await fetchExportFile("http://127.0.0.1:8008/api/export/watchlist.json").catch(
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(403);
  });

  it("連不上 sidecar 時拋 ApiError", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(
      fetchExportFile("http://127.0.0.1:8008/api/export/watchlist.json")
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("逾時的訊息與其他 API 一致，而不是 DOMException 的原文", async () => {
    mockFetch.mockRejectedValue(new DOMException("signal timed out", "TimeoutError"));

    const error = await fetchExportFile("http://127.0.0.1:8008/api/export/watchlist.json").catch(
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).detail).toBe(API_ERROR_MESSAGES.TIMED_OUT);
  });

  it("讀內容時失敗也包成 ApiError", async () => {
    const broken = response("");
    vi.spyOn(broken, "text").mockRejectedValue(new TypeError("network connection was lost"));
    mockFetch.mockResolvedValue(broken);

    await expect(
      fetchExportFile("http://127.0.0.1:8008/api/export/watchlist.json")
    ).rejects.toBeInstanceOf(ApiError);
  });
});
