/**
 * URL 驗證工具單元測試 — isSafeUrl、safeOpenUrl
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { isSafeUrl } from "../url";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("../logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

describe("isSafeUrl", () => {
  // ==================== 有效 URL ====================

  it("accepts https URL", () => {
    expect(isSafeUrl("https://github.com/user/repo")).toBe(true);
  });

  it("accepts http URL", () => {
    expect(isSafeUrl("http://example.com")).toBe(true);
  });

  it("accepts URL with path and query", () => {
    expect(isSafeUrl("https://github.com/search?q=test&lang=ts")).toBe(true);
  });

  // ==================== 封鎖的協定 ====================

  it("rejects javascript: protocol", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects data: protocol", () => {
    expect(isSafeUrl("data:text/html,<h1>hi</h1>")).toBe(false);
  });

  it("rejects file: protocol", () => {
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects ftp: protocol", () => {
    expect(isSafeUrl("ftp://example.com/file")).toBe(false);
  });

  // ==================== 封鎖的主機名 ====================

  it("rejects localhost", () => {
    expect(isSafeUrl("http://localhost:8008/api/repos")).toBe(false);
  });

  it("rejects 127.0.0.1", () => {
    expect(isSafeUrl("http://127.0.0.1:8008/api/repos")).toBe(false);
  });

  it("rejects 0.0.0.0", () => {
    expect(isSafeUrl("http://0.0.0.0:3000")).toBe(false);
  });

  it("rejects [::1] (IPv6 loopback)", () => {
    expect(isSafeUrl("http://[::1]:8008/api")).toBe(false);
  });

  it("rejects https://localhost", () => {
    expect(isSafeUrl("https://localhost/secret")).toBe(false);
  });

  it("rejects IPv6-mapped loopback [::ffff:127.0.0.1]", () => {
    expect(isSafeUrl("http://[::ffff:127.0.0.1]:8008/api")).toBe(false);
  });

  // ==================== 無效 URL ====================

  it("rejects empty string", () => {
    expect(isSafeUrl("")).toBe(false);
  });

  it("rejects malformed URL", () => {
    expect(isSafeUrl("not-a-url")).toBe(false);
  });

  it("rejects bare path", () => {
    expect(isSafeUrl("/api/repos")).toBe(false);
  });
});

describe("safeOpenUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens safe URL via Tauri", async () => {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    const { safeOpenUrl } = await import("../url");

    await safeOpenUrl("https://github.com");

    expect(openUrl).toHaveBeenCalledWith("https://github.com");
  });

  it("does not open unsafe URL", async () => {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    const { safeOpenUrl } = await import("../url");

    await safeOpenUrl("javascript:alert(1)");

    expect(openUrl).not.toHaveBeenCalled();
  });

  it("does not open localhost URL", async () => {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    const { safeOpenUrl } = await import("../url");

    await safeOpenUrl("http://localhost:8008/api/repos");

    expect(openUrl).not.toHaveBeenCalled();
  });
});
