import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "../../lib/react-query";

vi.mock("../../api/client", () => ({
  getGitHubConnectionStatus: vi.fn(),
}));

vi.mock("../../utils/error", () => ({
  getErrorMessage: (err: unknown, fallback: string) =>
    err instanceof Error ? err.message : fallback,
}));

import { getGitHubConnectionStatus } from "../../api/client";
import { useConnectionStatus } from "../useConnectionStatus";

const mockGetStatus = vi.mocked(getGitHubConnectionStatus);

function createWrapper() {
  const client = createTestQueryClient();
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

describe("useConnectionStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in loading state", () => {
    mockGetStatus.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useConnectionStatus(), { wrapper: createWrapper() });
    expect(result.current.state).toBe("loading");
    expect(result.current.status).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("sets connected state when API returns connected", async () => {
    mockGetStatus.mockResolvedValue({
      connected: true,
      username: "testuser",
    } as never);

    const { result } = renderHook(() => useConnectionStatus(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.state).toBe("connected");
    });

    expect(result.current.status?.connected).toBe(true);
    expect(result.current.status?.username).toBe("testuser");
    expect(result.current.error).toBeNull();
  });

  it("sets disconnected state when API returns not connected", async () => {
    mockGetStatus.mockResolvedValue({
      connected: false,
    } as never);

    const { result } = renderHook(() => useConnectionStatus(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.state).toBe("disconnected");
    });

    expect(result.current.status?.connected).toBe(false);
  });

  it("sets error state on API failure", async () => {
    mockGetStatus.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useConnectionStatus(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.state).toBe("error");
    });

    expect(result.current.error).toBe("Network error");
  });

  it("fetchStatus can be called manually to refresh", async () => {
    mockGetStatus.mockResolvedValueOnce({ connected: false } as never);

    const { result } = renderHook(() => useConnectionStatus(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.state).toBe("disconnected");
    });

    mockGetStatus.mockResolvedValueOnce({
      connected: true,
      username: "newuser",
    } as never);

    await act(async () => {
      await result.current.fetchStatus();
    });

    expect(result.current.state).toBe("connected");
    expect(result.current.status?.username).toBe("newuser");
  });
});
