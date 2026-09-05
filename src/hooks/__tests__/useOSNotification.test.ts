import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockIsPermissionGranted = vi.fn();
const mockRequestPermission = vi.fn();
const mockSendNotification = vi.fn();

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: (...args: unknown[]) => mockIsPermissionGranted(...args),
  requestPermission: (...args: unknown[]) => mockRequestPermission(...args),
  sendNotification: (...args: unknown[]) => mockSendNotification(...args),
}));

import { useOSNotification } from "../useOSNotification";

describe("useOSNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 模擬 Tauri 環境，讓 hook 不會 early return
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("checks permission on mount and sets isGranted", async () => {
    mockIsPermissionGranted.mockResolvedValue(true);

    const { result } = renderHook(() => useOSNotification());

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isGranted).toBe(true);
    expect(mockIsPermissionGranted).toHaveBeenCalled();
  });

  it("sets isGranted false when permission check fails", async () => {
    mockIsPermissionGranted.mockRejectedValue(new Error("No backend"));

    const { result } = renderHook(() => useOSNotification());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isGranted).toBe(false);
  });

  it("requestNotificationPermission returns true when granted", async () => {
    mockIsPermissionGranted.mockResolvedValue(false);
    mockRequestPermission.mockResolvedValue("granted");

    const { result } = renderHook(() => useOSNotification());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    let granted: boolean | undefined;
    await act(async () => {
      granted = await result.current.requestNotificationPermission();
    });

    expect(granted).toBe(true);
    expect(result.current.isGranted).toBe(true);
  });

  it("requestNotificationPermission returns false when denied", async () => {
    mockIsPermissionGranted.mockResolvedValue(false);
    mockRequestPermission.mockResolvedValue("denied");

    const { result } = renderHook(() => useOSNotification());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    let granted: boolean | undefined;
    await act(async () => {
      granted = await result.current.requestNotificationPermission();
    });

    expect(granted).toBe(false);
    expect(result.current.isGranted).toBe(false);
  });

  it("requestNotificationPermission returns false on error", async () => {
    mockIsPermissionGranted.mockResolvedValue(false);
    mockRequestPermission.mockRejectedValue(new Error("Failed"));

    const { result } = renderHook(() => useOSNotification());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    let granted: boolean | undefined;
    await act(async () => {
      granted = await result.current.requestNotificationPermission();
    });

    expect(granted).toBe(false);
  });

  it("sendOSNotification sends when granted", async () => {
    mockIsPermissionGranted.mockResolvedValue(true);
    mockSendNotification.mockReturnValue(undefined); // 同步 void，不是 promise

    const { result } = renderHook(() => useOSNotification());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.sendOSNotification({
        title: "Test",
        body: "Hello",
      });
    });

    expect(mockSendNotification).toHaveBeenCalledWith({
      title: "Test",
      body: "Hello",
      icon: undefined,
    });
  });

  it("sendOSNotification skips when not granted", async () => {
    mockIsPermissionGranted.mockResolvedValue(false);

    const { result } = renderHook(() => useOSNotification());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.sendOSNotification({
        title: "Test",
        body: "Hello",
      });
    });

    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("sendOSNotification rethrows a synchronous throw from sendNotification", async () => {
    mockIsPermissionGranted.mockResolvedValue(true);
    // 真實的 sendNotification 回傳 void。瀏覽器模式（沒有 Tauri shim）的失敗只會同步
    // throw；Tauri webview 裡的 shim 是 async + void，失敗根本到不了這個 catch——
    // 所以這條測的是瀏覽器路徑的 rethrow 契約，不是「通知送失敗會被回報」。
    // 用 mockRejectedValue 模擬的失敗模式兩種環境都不存在。
    mockSendNotification.mockImplementation(() => {
      throw new Error("Send failed");
    });

    const { result } = renderHook(() => useOSNotification());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await expect(
      act(async () => {
        await result.current.sendOSNotification({
          title: "Test",
          body: "Hello",
        });
      })
    ).rejects.toThrow("Send failed");
  });
});
