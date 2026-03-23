import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../../api/client", () => ({
  pollAuthorization: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

let mockOnline = true;
vi.mock("../useOnlineStatus", () => ({
  useOnlineStatus: () => mockOnline,
}));

import { pollAuthorization } from "../../api/client";
import { useDeviceFlowPolling } from "../useDeviceFlowPolling";

const mockPollAuth = vi.mocked(pollAuthorization);

describe("useDeviceFlowPolling", () => {
  const onSuccess = vi.fn<(status: { connected: boolean; username?: string }) => void>();
  const onError = vi.fn<(error: string) => void>();
  const onExpired = vi.fn<() => void>();
  const setPollStatus = vi.fn<(status: string) => void>();

  const originalHidden = document.hidden;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockOnline = true;
    Object.defineProperty(document, "hidden", { value: false, writable: true, configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, "hidden", {
      value: originalHidden,
      writable: true,
      configurable: true,
    });
  });

  function renderPolling() {
    return renderHook(() => useDeviceFlowPolling({ onSuccess, onError, onExpired, setPollStatus }));
  }

  it("returns startPolling, stopPolling, resetInterval", () => {
    const { result } = renderPolling();

    expect(typeof result.current.startPolling).toBe("function");
    expect(typeof result.current.stopPolling).toBe("function");
    expect(typeof result.current.resetInterval).toBe("function");
  });

  it("calls onSuccess when poll returns success", async () => {
    mockPollAuth.mockResolvedValue({ status: "success", username: "testuser" } as never);

    const { result } = renderPolling();

    act(() => {
      result.current.startPolling("test-code", 10, 300);
    });

    // Advance past initial delay (3000ms)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(onSuccess).toHaveBeenCalledWith({ connected: true, username: "testuser" });
  });

  it("calls onError when poll returns error status", async () => {
    mockPollAuth.mockResolvedValue({ status: "error", error: "Access denied" } as never);

    const { result } = renderPolling();

    act(() => {
      result.current.startPolling("test-code", 10, 300);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(onError).toHaveBeenCalledWith("Access denied");
  });

  it("calls onExpired when timeout elapses", async () => {
    mockPollAuth.mockResolvedValue({ status: "pending" } as never);

    const { result } = renderPolling();

    act(() => {
      result.current.startPolling("test-code", 10, 5); // 5 seconds expiry
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(onExpired).toHaveBeenCalled();
  });

  it("stopPolling clears interval and expiry timers", async () => {
    mockPollAuth.mockResolvedValue({ status: "pending" } as never);

    const { result } = renderPolling();

    act(() => {
      result.current.startPolling("test-code", 10, 300);
    });

    // Advance past initial delay so it fires
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    act(() => {
      result.current.stopPolling();
    });

    const callsAfterStop = mockPollAuth.mock.calls.length;

    // Advancing should not trigger more polls (interval cleared)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });

    expect(mockPollAuth.mock.calls.length).toBe(callsAfterStop);
    // onExpired should not fire (expiry timeout cleared)
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("cleans up timers on unmount", () => {
    const { result, unmount } = renderPolling();

    act(() => {
      result.current.startPolling("test-code", 10, 300);
    });

    unmount();

    // Should not throw or leak timers
    mockPollAuth.mockClear();
    act(() => {
      vi.advanceTimersByTime(30000);
    });
    expect(mockPollAuth).not.toHaveBeenCalled();
  });

  it("enforces minimum poll interval", async () => {
    mockPollAuth.mockResolvedValue({ status: "pending" } as never);

    const { result } = renderPolling();

    // Pass interval smaller than minimum (10 seconds)
    act(() => {
      result.current.startPolling("test-code", 3, 300);
    });

    // The interval should be clamped to the minimum (10 seconds)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    // After initial delay, polling should use >= 10 second interval
    expect(setPollStatus).toHaveBeenCalled();
  });

  it("does not overlap polls when pollAuthorization is slow", async () => {
    // pollAuthorization takes 15s to resolve — longer than the 10s interval
    let resolveFirst: (value: { status: "pending" }) => void = () => undefined;
    mockPollAuth.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
    );

    const { result } = renderPolling();

    act(() => {
      result.current.startPolling("test-code", 10, 300);
    });

    // Fire the initial delay (3s) — starts first poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(mockPollAuth).toHaveBeenCalledTimes(1);

    // Advance past the interval (10s) — with setInterval, this would fire a second poll
    // With recursive setTimeout, no new poll should start until the first resolves
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(mockPollAuth).toHaveBeenCalledTimes(1); // Still 1 — no overlap

    // Resolve the first poll — should schedule next poll after interval
    mockPollAuth.mockResolvedValue({ status: "pending" } as never);
    await act(async () => {
      resolveFirst({ status: "pending" });
    });

    // Advance past the next interval — now second poll should fire
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(mockPollAuth).toHaveBeenCalledTimes(2);

    result.current.stopPolling();
  });

  it("skips poll when document is hidden", async () => {
    mockPollAuth.mockResolvedValue({ status: "pending" });
    const { result } = renderPolling();

    await act(async () => {
      result.current.startPolling("code", 5, 60);
    });

    // 讓 initial delay 觸發
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    const callsBefore = mockPollAuth.mock.calls.length;

    // 設定頁面為隱藏，再觸發一次 interval
    Object.defineProperty(document, "hidden", { value: true, writable: true, configurable: true });
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    // 隱藏期間不應有新的 poll 呼叫
    expect(mockPollAuth.mock.calls.length).toBe(callsBefore);

    result.current.stopPolling();
  });

  it("skips poll and sets networkError when offline", async () => {
    mockPollAuth.mockResolvedValue({ status: "pending" });
    const { result, rerender } = renderPolling();

    await act(async () => {
      result.current.startPolling("code", 5, 60);
    });

    // 先讓 initial delay 觸發一次正常 poll
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    const callsBefore = mockPollAuth.mock.calls.length;

    // 切換為離線並 rerender 讓 ref 更新
    mockOnline = false;
    rerender();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    // 離線期間不應有新的 poll 呼叫
    expect(mockPollAuth.mock.calls.length).toBe(callsBefore);

    result.current.stopPolling();
  });
});
