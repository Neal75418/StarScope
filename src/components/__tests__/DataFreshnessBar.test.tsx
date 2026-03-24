/**
 * DataFreshnessBar 元件測試。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { DataFreshnessBar } from "../DataFreshnessBar";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

let mockOnline = true;
vi.mock("../../contexts/AppStatusContext", () => ({
  useAppStatus: () => ({
    isOnline: mockOnline,
    level: mockOnline ? "online" : "offline",
    showBanner: !mockOnline,
    bannerMessage: mockOnline ? null : "offline",
    isSidecarUp: true,
  }),
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: {
      common: {
        lastUpdated: "Updated",
        offline: "Offline",
        syncing: "Syncing...",
        refresh: "Refresh",
      },
    },
  }),
}));

describe("DataFreshnessBar", () => {
  beforeEach(() => {
    mockOnline = true;
  });

  it("renders nothing when dataUpdatedAt is 0", () => {
    const { container } = render(<DataFreshnessBar dataUpdatedAt={0} isFetching={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders last updated time", () => {
    render(<DataFreshnessBar dataUpdatedAt={Date.now() - 60_000} isFetching={false} />);
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
  });

  it("shows offline indicator when offline", () => {
    mockOnline = false;
    render(<DataFreshnessBar dataUpdatedAt={Date.now()} isFetching={false} />);
    expect(screen.getByText(/Offline/)).toBeInTheDocument();
  });

  it("shows syncing indicator when fetching", () => {
    render(<DataFreshnessBar dataUpdatedAt={Date.now()} isFetching={true} />);
    expect(screen.getByText("Syncing...")).toBeInTheDocument();
  });

  it("shows refresh button when onRefresh provided and not fetching", () => {
    const onRefresh = vi.fn();
    render(
      <DataFreshnessBar dataUpdatedAt={Date.now()} isFetching={false} onRefresh={onRefresh} />
    );
    expect(screen.getByLabelText("Refresh")).toBeInTheDocument();
  });

  it("hides refresh button when fetching", () => {
    render(<DataFreshnessBar dataUpdatedAt={Date.now()} isFetching={true} onRefresh={vi.fn()} />);
    expect(screen.queryByLabelText("Refresh")).not.toBeInTheDocument();
  });

  it("calls onRefresh when button clicked", async () => {
    const onRefresh = vi.fn();
    render(
      <DataFreshnessBar dataUpdatedAt={Date.now()} isFetching={false} onRefresh={onRefresh} />
    );
    await userEvent.click(screen.getByLabelText("Refresh"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
