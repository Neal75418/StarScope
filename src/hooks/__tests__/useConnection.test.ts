import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useConnection } from "../useConnection";
import * as apiClient from "../../api/client";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    checkHealth: vi.fn(),
  };
});


describe("useConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct initial state", () => {
    const { result } = renderHook(() => useConnection());

    expect(result.current.isConnected).toBe(false);
    expect(result.current.connectionError).toBeNull();
  });

  it("sets connected on successful health check", async () => {
    vi.mocked(apiClient.checkHealth).mockResolvedValue({
      status: "ok",
      service: "starscope",
      timestamp: "2024-01-01T00:00:00Z",
    });

    const { result } = renderHook(() => useConnection());

    let connected = false;
    await act(async () => {
      connected = await result.current.checkConnection();
    });

    expect(connected).toBe(true);
    expect(result.current.isConnected).toBe(true);
    expect(result.current.connectionError).toBeNull();
  });

  it("sets error on failed health check", async () => {
    vi.mocked(apiClient.checkHealth).mockRejectedValue(new Error("timeout"));

    const { result } = renderHook(() => useConnection());

    let connected = true;
    await act(async () => {
      connected = await result.current.checkConnection();
    });

    expect(connected).toBe(false);
    expect(result.current.isConnected).toBe(false);
    expect(result.current.connectionError).toBe("Connecting to StarScope engine. Please wait...");
  });

  it("clears error after successful reconnection", async () => {
    vi.mocked(apiClient.checkHealth).mockRejectedValue(new Error("timeout"));

    const { result } = renderHook(() => useConnection());

    await act(async () => {
      await result.current.checkConnection();
    });
    expect(result.current.connectionError).toBe("Connecting to StarScope engine. Please wait...");

    vi.mocked(apiClient.checkHealth).mockResolvedValue({
      status: "ok",
      service: "starscope",
      timestamp: "2024-01-01T00:00:00Z",
    });

    await act(async () => {
      await result.current.checkConnection();
    });
    expect(result.current.connectionError).toBeNull();
    expect(result.current.isConnected).toBe(true);
  });
});
