import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { StatusBanner } from "../StatusBanner";
import type { AppStatus } from "../../contexts/AppStatusContext";

// 可訂閱的替身：StatusBanner 包了 memo，狀態變了要像真的 context 一樣觸發重新渲染
const status: { current: AppStatus } = {
  current: {
    level: "online",
    showBanner: false,
    bannerMessage: null,
    isSidecarUp: true,
    isOnline: true,
  },
};
const listeners = new Set<() => void>();
function setStatus(next: AppStatus) {
  status.current = next;
  listeners.forEach((listener) => listener());
}
vi.mock("../../contexts/AppStatusContext", () => ({
  useAppStatus: () =>
    useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => status.current
    ),
}));

describe("StatusBanner", () => {
  it("announces the engine starting politely instead of as an alert", () => {
    // 每次開 app 都會經過「啟動中」：用 alert 會打斷螢幕閱讀器正在念的內容
    status.current = {
      level: "sidecar-starting",
      showBanner: true,
      bannerMessage: "sidecarStarting",
      isSidecarUp: false,
      isOnline: true,
    };
    render(<StatusBanner />);

    const banner = screen.getByTestId("status-banner");
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveAttribute("aria-live", "polite");
  });

  it("inserts a fresh alert when starting turns into down", () => {
    // 同一個節點同時改 role／aria-live 和文字，有些螢幕閱讀器會漏念；新插入的 alert 一定會念
    status.current = {
      level: "sidecar-starting",
      showBanner: true,
      bannerMessage: "sidecarStarting",
      isSidecarUp: false,
      isOnline: true,
    };
    render(<StatusBanner />);
    const starting = screen.getByTestId("status-banner");

    act(() =>
      setStatus({ ...status.current, level: "sidecar-down", bannerMessage: "sidecarDown" })
    );

    expect(screen.getByTestId("status-banner")).toHaveAttribute("role", "alert");
    expect(screen.getByTestId("status-banner")).not.toBe(starting);
  });

  it("keeps real problems as alerts", () => {
    status.current = {
      level: "sidecar-down",
      showBanner: true,
      bannerMessage: "sidecarDown",
      isSidecarUp: false,
      isOnline: true,
    };
    render(<StatusBanner />);

    const banner = screen.getByTestId("status-banner");
    expect(banner).toHaveAttribute("role", "alert");
    expect(banner).toHaveAttribute("aria-live", "assertive");
  });
});
