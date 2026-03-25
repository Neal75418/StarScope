import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode, SetStateAction } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useNotificationPolling } from "../useNotificationPolling";
import type { Notification } from "../useNotifications";
import * as apiClient from "../../api/client";
import { createTestQueryClient } from "../../lib/react-query";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    listTriggeredAlerts: vi.fn(),
  };
});

vi.mock("../../utils/notificationHelpers", () => ({
  alertsToNotifications: vi.fn(() => []),
  sortNotifications: vi.fn((n: Notification[]) => n),
  mergeNotifications: vi.fn((newN: Notification[]) => newN),
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

function createWrapper() {
  const client = createTestQueryClient();
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

describe("useNotificationPolling", () => {
  let mockSetNotifications: ReturnType<
    typeof vi.fn<(value: SetStateAction<Notification[]>) => void>
  >;
  let mockReadIdsRef: { current: Set<string> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSetNotifications = vi.fn<(value: SetStateAction<Notification[]>) => void>();
    mockReadIdsRef = { current: new Set<string>() };
    vi.mocked(apiClient.listTriggeredAlerts).mockResolvedValue([]);
  });

  afterEach(() => {
    // Restore document.hidden to default (tests may override it)
    Object.defineProperty(document, "hidden", { value: false, writable: true });
  });

  it("fetches notifications on mount", async () => {
    renderHook(() => useNotificationPolling(mockSetNotifications, mockReadIdsRef), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(apiClient.listTriggeredAlerts).toHaveBeenCalledWith(false, 50);
    });
  });

  it("starts in loading state and becomes false after fetch", async () => {
    const { result } = renderHook(
      () => useNotificationPolling(mockSetNotifications, mockReadIdsRef),
      { wrapper: createWrapper() }
    );

    // React Query will fetch immediately
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it("sets error on API failure", async () => {
    vi.mocked(apiClient.listTriggeredAlerts).mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(
      () => useNotificationPolling(mockSetNotifications, mockReadIdsRef),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.error).toBe("Network error");
    });
  });

  it("refresh triggers a new fetch", async () => {
    const { result } = renderHook(
      () => useNotificationPolling(mockSetNotifications, mockReadIdsRef),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(apiClient.listTriggeredAlerts).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(apiClient.listTriggeredAlerts).toHaveBeenCalledTimes(2);
    });
  });

  it("cleans up on unmount", async () => {
    const { unmount } = renderHook(
      () => useNotificationPolling(mockSetNotifications, mockReadIdsRef),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(apiClient.listTriggeredAlerts).toHaveBeenCalledTimes(1);
    });

    unmount();

    // Flush pending microtasks after unmount
    await act(async () => {});

    // After unmount, no more fetches should occur
    expect(vi.mocked(apiClient.listTriggeredAlerts).mock.calls.length).toBe(1);
  });

  it("handles non-Error exceptions in fetch", async () => {
    vi.mocked(apiClient.listTriggeredAlerts).mockRejectedValue("string error");

    const { result } = renderHook(
      () => useNotificationPolling(mockSetNotifications, mockReadIdsRef),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      // Non-Error exceptions produce the i18n fallback message
      expect(result.current.error).toBe("Failed to fetch notifications");
    });
  });
});
