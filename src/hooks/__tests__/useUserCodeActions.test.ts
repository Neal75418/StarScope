/**
 * useUserCodeActions 的安全性測試。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock dependencies
vi.mock("../../utils/url", () => ({
  isSafeUrl: vi.fn(),
  safeOpenUrl: vi.fn(),
}));

vi.mock("../../constants/api", () => ({
  CLIPBOARD_FEEDBACK_MS: 100,
}));

import { useUserCodeActions } from "../useUserCodeActions";
import { isSafeUrl, safeOpenUrl } from "../../utils/url";
import type { DeviceCodeResponse } from "../../api/client";

function makeDeviceCode(overrides: Partial<DeviceCodeResponse> = {}): DeviceCodeResponse {
  return {
    device_code: "abc123",
    user_code: "ABCD-1234",
    verification_uri: "https://github.com/login/device",
    expires_in: 900,
    interval: 5,
    ...overrides,
  };
}

describe("useUserCodeActions", () => {
  let mockWindowOpen: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWindowOpen = vi.fn();
    vi.stubGlobal("open", mockWindowOpen);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens URL via safeOpenUrl when Tauri opener works", async () => {
    vi.mocked(safeOpenUrl).mockResolvedValue(undefined);
    const { result } = renderHook(() => useUserCodeActions(makeDeviceCode()));

    await act(async () => {
      await result.current.openGitHubManually();
    });

    expect(safeOpenUrl).toHaveBeenCalledWith("https://github.com/login/device");
    expect(mockWindowOpen).not.toHaveBeenCalled();
  });

  it("falls back to window.open when safeOpenUrl fails and URL is safe", async () => {
    vi.mocked(safeOpenUrl).mockRejectedValue(new Error("Tauri not available"));
    vi.mocked(isSafeUrl).mockReturnValue(true);
    const { result } = renderHook(() => useUserCodeActions(makeDeviceCode()));

    await act(async () => {
      await result.current.openGitHubManually();
    });

    expect(isSafeUrl).toHaveBeenCalledWith("https://github.com/login/device");
    expect(mockWindowOpen).toHaveBeenCalledWith(
      "https://github.com/login/device",
      "_blank",
      "noopener,noreferrer"
    );
  });

  it("does NOT fall back to window.open when URL is unsafe", async () => {
    vi.mocked(safeOpenUrl).mockRejectedValue(new Error("Tauri not available"));
    vi.mocked(isSafeUrl).mockReturnValue(false);
    const code = makeDeviceCode({ verification_uri: "javascript:alert(1)" });
    const { result } = renderHook(() => useUserCodeActions(code));

    await act(async () => {
      await result.current.openGitHubManually();
    });

    expect(isSafeUrl).toHaveBeenCalledWith("javascript:alert(1)");
    expect(mockWindowOpen).not.toHaveBeenCalled();
  });

  it("does nothing when deviceCode is null", async () => {
    const { result } = renderHook(() => useUserCodeActions(null));

    await act(async () => {
      await result.current.openGitHubManually();
    });

    expect(safeOpenUrl).not.toHaveBeenCalled();
    expect(mockWindowOpen).not.toHaveBeenCalled();
  });
});
