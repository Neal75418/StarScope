import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode, SetStateAction } from "react";
import { QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { useNotificationPolling } from "../useNotificationPolling";
import type { Notification } from "../useNotifications";
import type { LocalMarks } from "../../utils/notificationHelpers";
import * as apiClient from "../../api/client";
import { createTestQueryClient, queryKeys } from "../../lib/react-query";

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
  let mockLocalMarksRef: { current: LocalMarks };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSetNotifications = vi.fn<(value: SetStateAction<Notification[]>) => void>();
    mockLocalMarksRef = { current: { reads: new Set(), dismissals: new Set() } };
    vi.mocked(apiClient.listTriggeredAlerts).mockResolvedValue([]);
  });

  afterEach(() => {
    // Restore document.hidden to default (tests may override it)
    Object.defineProperty(document, "hidden", { value: false, writable: true });
  });

  it("counts as loading while the query is paused before its first answer", async () => {
    // sidecar 還沒連上時查詢是暫停的：isLoading 是 false，鈴鐺會誤說「沒有通知」
    onlineManager.setOnline(false);
    try {
      const { result } = renderHook(
        () => useNotificationPolling(mockSetNotifications, mockLocalMarksRef),
        { wrapper: createWrapper() }
      );
      expect(result.current.isLoading).toBe(true);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("fetches notifications on mount", async () => {
    renderHook(() => useNotificationPolling(mockSetNotifications, mockLocalMarksRef), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      // 鈴鐺不列清除過的（儀表板的近期活動另外讀，照列）
      expect(apiClient.listTriggeredAlerts).toHaveBeenCalledWith(false, 50, undefined, {
        excludeDismissed: true,
      });
    });
  });

  it("starts in loading state and becomes false after fetch", async () => {
    const { result } = renderHook(
      () => useNotificationPolling(mockSetNotifications, mockLocalMarksRef),
      { wrapper: createWrapper() }
    );

    // React Query will fetch immediately
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it("reports the failed load on API failure", async () => {
    vi.mocked(apiClient.listTriggeredAlerts).mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(
      () => useNotificationPolling(mockSetNotifications, mockLocalMarksRef),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.loadFailed).toBe(true);
    });
  });

  it("keeps reporting the failed load while a retry is in flight", async () => {
    // 還沒讀到過任何通知時，重試一開始 React Query 就把 error 清掉；畫面上的「讀不到」不能跟著消失
    vi.mocked(apiClient.listTriggeredAlerts).mockRejectedValueOnce(new Error("Network error"));
    const { result } = renderHook(
      () => useNotificationPolling(mockSetNotifications, mockLocalMarksRef),
      { wrapper: createWrapper() }
    );
    await waitFor(() => expect(result.current.loadFailed).toBe(true));
    expect(result.current.loadInProgress).toBe(false);

    let finishRetry: (alerts: never[]) => void = () => {};
    vi.mocked(apiClient.listTriggeredAlerts).mockReturnValue(
      new Promise((resolve) => {
        finishRetry = resolve;
      })
    );
    act(() => {
      void result.current.refresh();
    });

    await waitFor(() => expect(result.current.loadInProgress).toBe(true));
    expect(result.current.loadFailed).toBe(true);

    await act(async () => {
      finishRetry([]);
    });
    await waitFor(() => expect(result.current.loadFailed).toBe(false));
  });

  it("refresh triggers a new fetch", async () => {
    const { result } = renderHook(
      () => useNotificationPolling(mockSetNotifications, mockLocalMarksRef),
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

  it("refresh also reads the dashboard's triggered alerts again", async () => {
    // 通知中心用它在確認、清除之後重讀：儀表板的「啟用中的警報」是同一份資料，不輪詢
    // 不回收沒人看的查詢：先放進去的那份要留到斷言的時候
    const client = createTestQueryClient();
    client.setDefaultOptions({
      queries: { ...client.getDefaultOptions().queries, gcTime: Infinity },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    client.setQueryData(queryKeys.alerts.triggered(), []);
    const { result } = renderHook(
      () => useNotificationPolling(mockSetNotifications, mockLocalMarksRef),
      { wrapper }
    );

    await act(async () => {
      await result.current.refresh();
    });

    expect(client.getQueryState(queryKeys.alerts.triggered())?.isInvalidated).toBe(true);
  });

  it("cleans up on unmount", async () => {
    const { unmount } = renderHook(
      () => useNotificationPolling(mockSetNotifications, mockLocalMarksRef),
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
      () => useNotificationPolling(mockSetNotifications, mockLocalMarksRef),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.loadFailed).toBe(true);
    });
  });
});
