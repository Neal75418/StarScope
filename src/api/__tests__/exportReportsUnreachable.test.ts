/**
 * 匯出檔的請求不走 doFetch：連不上 sidecar 時也要觸發立刻重探，
 * 跟其他打 sidecar 的路徑一致（見 sidecarConnection.ts）。
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../sessionSecret", () => ({ getSessionSecret: async () => null }));
vi.mock("../sidecarConnection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sidecarConnection")>()),
  reportSidecarUnreachable: vi.fn(),
}));

import { fetchExportFile } from "../client";
import { reportSidecarUnreachable } from "../sidecarConnection";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(reportSidecarUnreachable).mockClear();
});

describe("fetchExportFile", () => {
  it("reports an unreachable sidecar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("Load failed")))
    );

    await expect(
      fetchExportFile("http://127.0.0.1:8008/api/export/watchlist.json")
    ).rejects.toThrow(/Network error/);
    expect(reportSidecarUnreachable).toHaveBeenCalledTimes(1);
  });

  it("does not report a request that timed out", async () => {
    // 逾時代表 sidecar 在、只是慢：不是「連不上」
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new DOMException("slow", "TimeoutError")))
    );

    await expect(
      fetchExportFile("http://127.0.0.1:8008/api/export/watchlist.json")
    ).rejects.toThrow();
    expect(reportSidecarUnreachable).not.toHaveBeenCalled();
  });

  it("does not report a sidecar that answered with an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => ({ ok: false, status: 500, json: async () => ({ detail: "boom" }) }) as Response
      )
    );

    await expect(
      fetchExportFile("http://127.0.0.1:8008/api/export/watchlist.json")
    ).rejects.toThrow();
    expect(reportSidecarUnreachable).not.toHaveBeenCalled();
  });
});
