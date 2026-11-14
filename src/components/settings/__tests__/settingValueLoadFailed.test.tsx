/**
 * 三個「設定值」區塊（定時更新、快照保留、訊號門檻）讀不到目前設定時的畫面。
 *
 * 讀不到時不能把預設值畫成目前的設定：使用者看到的 60 分鐘、90 天可能根本不是他存的值，
 * 而且「選回預設值」會因為畫面認為沒變而存不進去。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import type { ReactNode } from "react";
import * as client from "../../../api/client";
import { ScheduledRefreshSection } from "../ScheduledRefreshSection";
import { SnapshotRetentionSection } from "../SnapshotRetentionSection";
import { SignalThresholdsSection } from "../SignalThresholdsSection";

vi.mock("../../../api/client");

function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const sections = [
  {
    name: "ScheduledRefreshSection",
    ui: <ScheduledRefreshSection onToast={vi.fn()} />,
    load: () => vi.mocked(client.getFetchInterval) as unknown as ReturnType<typeof vi.fn>,
    stored: { interval_minutes: 360 },
    // 存的是 360 分鐘；預設值是 60
    storedValue: "360",
  },
  {
    name: "SnapshotRetentionSection",
    ui: <SnapshotRetentionSection onToast={vi.fn()} />,
    load: () => vi.mocked(client.getSnapshotRetention) as unknown as ReturnType<typeof vi.fn>,
    stored: { retention_days: 180 },
    // 存的是 180 天；預設值是 90
    storedValue: "180",
  },
  {
    name: "SignalThresholdsSection",
    ui: <SignalThresholdsSection onToast={vi.fn()} />,
    load: () => vi.mocked(client.getSignalThresholds) as unknown as ReturnType<typeof vi.fn>,
    stored: {
      rising_star_min_velocity: 25,
      sudden_spike_multiplier: 3,
      breakout_velocity_threshold: 2,
      viral_hn_min_score: 100,
    },
    // 第一欄存的是 25；預設值是 10
    storedValue: "25",
  },
];

/** 區塊裡第一個設定值的輸入元件（下拉或數字欄）；還沒畫出來時是 null */
function firstControl(): HTMLInputElement | HTMLSelectElement | null {
  return document.querySelector("select, input");
}

describe.each(sections)(
  "$name when the stored setting cannot be read",
  ({ ui, load, stored, storedValue }) => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("says so instead of showing a default as if it were the current setting", async () => {
      load().mockRejectedValue(new Error("boom"));
      renderWithClient(ui);

      expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load this setting.");
      expect(firstControl()).toBeNull();
      // 也不留著載入中的骨架：讀取已經有結果了（失敗），不是還在讀
      expect(document.querySelector(".skeleton")).toBeNull();
    });

    it("shows the stored setting once retry succeeds", async () => {
      load().mockRejectedValueOnce(new Error("boom"));
      load().mockResolvedValue(stored);
      renderWithClient(ui);
      await screen.findByRole("alert");

      fireEvent.click(screen.getByRole("button", { name: "Retry" }));

      await vi.waitFor(() => expect(firstControl()).not.toBeNull());
      expect(firstControl()).toHaveValue(
        firstControl() instanceof HTMLSelectElement ? storedValue : Number(storedValue)
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("does not show a default while the query is paused", async () => {
      // 連上過 sidecar 之後又斷線：查詢是暫停的，還不知道存的是什麼
      onlineManager.setOnline(false);
      try {
        renderWithClient(ui);
        // 等一拍：React Query 以 setTimeout(0) 才通知元件，馬上斷言「沒出現」會空過
        await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

        expect(load()).not.toHaveBeenCalled();
        expect(firstControl()).toBeNull();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      } finally {
        onlineManager.setOnline(true);
      }
    });
  }
);
