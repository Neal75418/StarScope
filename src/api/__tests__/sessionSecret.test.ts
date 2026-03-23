/**
 * sessionSecret 模組的單元測試。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

describe("sessionSecret", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 每個測試重新載入模組，清除 cachedSecret
    vi.resetModules();
  });

  it("fetches secret from Tauri invoke and caches it", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValue("test-secret-abc123");

    const { getSessionSecret } = await import("../sessionSecret");

    const secret = await getSessionSecret();
    expect(secret).toBe("test-secret-abc123");
    expect(invoke).toHaveBeenCalledWith("get_session_secret");

    // 第二次呼叫使用快取，不再 invoke
    const secret2 = await getSessionSecret();
    expect(secret2).toBe("test-secret-abc123");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("returns null when Tauri invoke fails (dev mode)", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockRejectedValue(new Error("not in Tauri"));

    const { getSessionSecret } = await import("../sessionSecret");

    const secret = await getSessionSecret();
    expect(secret).toBeNull();
  });

  it("retries on subsequent calls after initial failure", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke)
      .mockRejectedValueOnce(new Error("not ready"))
      .mockResolvedValueOnce("delayed-secret");

    const { getSessionSecret } = await import("../sessionSecret");

    // First call fails
    const s1 = await getSessionSecret();
    expect(s1).toBeNull();

    // Second call succeeds (null is not cached)
    const s2 = await getSessionSecret();
    expect(s2).toBe("delayed-secret");
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
