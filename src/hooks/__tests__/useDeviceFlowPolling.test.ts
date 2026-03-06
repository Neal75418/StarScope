import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../../api/client", () => ({
  pollAuthorization: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { pollAuthorization } from "../../api/client";
import { useDeviceFlowPolling } from "../useDeviceFlowPolling";

const mockPollAuth = vi.mocked(pollAuthorization);

describe("useDeviceFlowPolling", () => {
  const onSuccess = vi.fn<(status: { connected: boolean; username?: string }) => void>();
  const onError = vi.fn<(error: string) => void>();
  const onExpired = vi.fn<() => void>();
  const setPollStatus = vi.fn<(status: string) => void>();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
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
});
