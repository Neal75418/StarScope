import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Helper to override import.meta.env.DEV for production tests
function setDevMode(value: boolean) {
  (import.meta.env as Record<string, unknown>).DEV = value;
}

describe("logger", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    setDevMode(true);
  });

  describe("in development mode (DEV=true)", () => {
    it("outputs error with message and error object", async () => {
      const { logger } = await import("../logger");
      const err = new Error("test");
      logger.error("載入失敗:", err);
      expect(errorSpy).toHaveBeenCalledWith("載入失敗:", err);
    });

    it("outputs error with message only", async () => {
      const { logger } = await import("../logger");
      logger.error("發生錯誤");
      expect(errorSpy).toHaveBeenCalledWith("發生錯誤");
    });

    it("outputs warn with message and error object", async () => {
      const { logger } = await import("../logger");
      const err = new Error("warn");
      logger.warn("警告:", err);
      expect(warnSpy).toHaveBeenCalledWith("警告:", err);
    });

    it("outputs info with message", async () => {
      const { logger } = await import("../logger");
      logger.info("資訊訊息");
      expect(infoSpy).toHaveBeenCalledWith("資訊訊息");
    });

    it("supports template literal prefixes", async () => {
      const { logger } = await import("../logger");
      const prefix = "useMyHook";
      const err = new Error("fail");
      logger.error(`[${prefix}] 載入錯誤:`, err);
      expect(errorSpy).toHaveBeenCalledWith("[useMyHook] 載入錯誤:", err);
    });
  });

  describe("in production mode (DEV=false)", () => {
    beforeEach(() => {
      setDevMode(false);
    });

    it("does not output error", async () => {
      const { logger } = await import("../logger");
      logger.error("載入失敗:", new Error("test"));
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("does not output warn", async () => {
      const { logger } = await import("../logger");
      logger.warn("警告:", new Error("test"));
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("does not output info", async () => {
      const { logger } = await import("../logger");
      logger.info("資訊訊息");
      expect(infoSpy).not.toHaveBeenCalled();
    });
  });
});
