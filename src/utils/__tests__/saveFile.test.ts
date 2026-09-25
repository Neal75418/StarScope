/**
 * saveFile / saveExport：Tauri 裡交給 Rust 的 save_file（原生另存新檔），瀏覽器裡退回 Blob 下載。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { saveExport, saveFile } from "../saveFile";
import { fetchExportFile } from "../../api/client";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../api/client", () => ({ fetchExportFile: vi.fn() }));

const EXPORT_URL = "http://127.0.0.1:8008/api/export/watchlist.json";

function inTauri(enabled: boolean) {
  const w = window as unknown as Record<string, unknown>;
  if (enabled) w.__TAURI_INTERNALS__ = {};
  else delete w.__TAURI_INTERNALS__;
}

const bytesOf = (text: string) => Array.from(new TextEncoder().encode(text));

describe("saveFile / saveExport", () => {
  beforeEach(() => {
    vi.mocked(fetchExportFile).mockResolvedValue({
      content: '{"repos": []}',
      filename: "starscope_watchlist_20260925.json",
    });
  });

  afterEach(() => {
    inTauri(false);
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe("在 Tauri 裡", () => {
    beforeEach(() => {
      inTauri(true);
    });

    it("把後端給的檔名與內容交給 save_file，前端不經手路徑", async () => {
      vi.mocked(invoke).mockResolvedValue(true);

      const result = await saveExport(EXPORT_URL, "starscope_watchlist.json");

      expect(result).toBe("saved");
      expect(invoke).toHaveBeenCalledWith("save_file", {
        defaultName: "starscope_watchlist_20260925.json",
        contents: bytesOf('{"repos": []}'),
      });
    });

    it("使用者取消對話框時回 cancelled", async () => {
      vi.mocked(invoke).mockResolvedValue(false);

      expect(await saveExport(EXPORT_URL, "starscope_watchlist.json")).toBe("cancelled");
    });

    it("取不到內容時不開對話框——不讓使用者先選好位置才告訴他失敗", async () => {
      vi.mocked(fetchExportFile).mockRejectedValue(new Error("403"));

      await expect(saveExport(EXPORT_URL, "starscope_watchlist.json")).rejects.toThrow("403");
      expect(invoke).not.toHaveBeenCalled();
    });

    it("後端沒給檔名時用呼叫端的預設檔名", async () => {
      vi.mocked(fetchExportFile).mockResolvedValue({ content: "a,b\n", filename: null });
      vi.mocked(invoke).mockResolvedValue(true);

      await saveExport(EXPORT_URL, "starscope_trends.csv");

      expect(vi.mocked(invoke).mock.calls[0][1]).toMatchObject({
        defaultName: "starscope_trends.csv",
      });
    });

    it("寫檔失敗時往外拋，不回報成功", async () => {
      vi.mocked(invoke).mockRejectedValue("/Users/me/x.json: Permission denied");

      await expect(saveExport(EXPORT_URL, "starscope_watchlist.json")).rejects.toBe(
        "/Users/me/x.json: Permission denied"
      );
    });

    it("二進位內容（PNG）原樣傳過去", async () => {
      vi.mocked(invoke).mockResolvedValue(true);
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

      await saveFile("comparison-chart.png", png);

      expect(invoke).toHaveBeenCalledWith("save_file", {
        defaultName: "comparison-chart.png",
        contents: [0x89, 0x50, 0x4e, 0x47],
      });
    });
  });

  describe("在瀏覽器裡（Vite 開發、e2e）", () => {
    it("用 Blob 觸發下載，不呼叫 Tauri，blob 網址延後才釋放", async () => {
      vi.useFakeTimers();
      const clicked: { href: string; download: string }[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
        this: HTMLAnchorElement
      ) {
        clicked.push({ href: this.href, download: this.download });
      });
      const revokeObjectURL = vi.fn();
      vi.stubGlobal(
        "URL",
        Object.assign(URL, {
          createObjectURL: vi.fn().mockReturnValue("blob:mock"),
          revokeObjectURL,
        })
      );

      const result = await saveExport(EXPORT_URL, "starscope_watchlist.json");

      expect(result).toBe("saved");
      expect(clicked).toEqual([
        { href: "blob:mock", download: "starscope_watchlist_20260925.json" },
      ]);
      expect(invoke).not.toHaveBeenCalled();
      // WebKit 在 click 之後立刻 revoke 會讓下載失敗
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");

      vi.unstubAllGlobals();
    });
  });
});
