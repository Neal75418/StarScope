import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ConnectionConnected } from "../ConnectionConnected";
import type { GitHubConnectionStatus } from "../../../api/types";

function makeStatus(overrides: Partial<GitHubConnectionStatus> = {}): GitHubConnectionStatus {
  return {
    connected: true,
    username: "testuser",
    rate_limit_remaining: 4500,
    rate_limit_total: 5000,
    rate_limit_reset: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  } as GitHubConnectionStatus;
}

describe("ConnectionConnected", () => {
  const onDisconnect = vi.fn<() => void>();
  const onRefresh = vi.fn<() => Promise<void>>();

  beforeEach(() => {
    vi.useFakeTimers();
    onDisconnect.mockReset();
    onRefresh.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders username", () => {
    render(
      <ConnectionConnected
        status={makeStatus()}
        onDisconnect={onDisconnect}
        onRefresh={onRefresh}
      />
    );

    expect(screen.getByText("@testuser")).toBeInTheDocument();
  });

  it("renders rate limit info", () => {
    render(
      <ConnectionConnected
        status={makeStatus({ rate_limit_remaining: 4500, rate_limit_total: 5000 })}
        onDisconnect={onDisconnect}
        onRefresh={onRefresh}
      />
    );

    expect(screen.getByText(/4,500/)).toBeInTheDocument();
    expect(screen.getByText(/5,000/)).toBeInTheDocument();
  });

  it("shows rate limit warning when below 20%", () => {
    const { container } = render(
      <ConnectionConnected
        status={makeStatus({ rate_limit_remaining: 100, rate_limit_total: 5000 })}
        onDisconnect={onDisconnect}
        onRefresh={onRefresh}
      />
    );

    const warningEl = container.querySelector(".rate-limit-warning");
    expect(warningEl).toBeInTheDocument();
  });

  it("does not show rate limit warning when above 20%", () => {
    const { container } = render(
      <ConnectionConnected
        status={makeStatus({ rate_limit_remaining: 4500, rate_limit_total: 5000 })}
        onDisconnect={onDisconnect}
        onRefresh={onRefresh}
      />
    );

    const warningEl = container.querySelector(".rate-limit-warning");
    expect(warningEl).not.toBeInTheDocument();
  });

  it("shows countdown timer", () => {
    const resetTime = Math.floor(Date.now() / 1000) + 2700; // 45 min from now
    render(
      <ConnectionConnected
        status={makeStatus({ rate_limit_reset: resetTime })}
        onDisconnect={onDisconnect}
        onRefresh={onRefresh}
      />
    );

    // Should show something like "45m 0s" or "44m 59s"
    expect(screen.getByText(/\d+m \d+s/)).toBeInTheDocument();
  });

  it("countdown updates every second", () => {
    const resetTime = Math.floor(Date.now() / 1000) + 60; // 60 seconds
    render(
      <ConnectionConnected
        status={makeStatus({ rate_limit_reset: resetTime })}
        onDisconnect={onDisconnect}
        onRefresh={onRefresh}
      />
    );

    const initialText = screen.getByText(/\d+s/).textContent;

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Countdown should have decreased
    const updatedText = screen.getByText(/\d+s/).textContent;
    expect(updatedText).not.toBe(initialText);
  });

  it("disconnect button calls onDisconnect", () => {
    render(
      <ConnectionConnected
        status={makeStatus()}
        onDisconnect={onDisconnect}
        onRefresh={onRefresh}
      />
    );

    fireEvent.click(screen.getByText("Disconnect"));

    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it("refresh button calls onRefresh and shows loading", async () => {
    let resolveRefresh: () => void = () => {};
    onRefresh.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRefresh = resolve;
      })
    );

    render(
      <ConnectionConnected
        status={makeStatus()}
        onDisconnect={onDisconnect}
        onRefresh={onRefresh}
      />
    );

    const refreshBtn = screen.getByTitle("Refresh");
    fireEvent.click(refreshBtn);

    expect(onRefresh).toHaveBeenCalledTimes(1);
    // During refresh, button shows "..."
    expect(refreshBtn.textContent).toBe("...");
    expect(refreshBtn).toBeDisabled();

    await act(async () => {
      resolveRefresh();
    });

    // After refresh, button shows "↻" again
    expect(refreshBtn.textContent).toBe("↻");
    expect(refreshBtn).not.toBeDisabled();
  });

  it("hides rate limit section when rate_limit_remaining is undefined", () => {
    render(
      <ConnectionConnected
        status={makeStatus({ rate_limit_remaining: undefined })}
        onDisconnect={onDisconnect}
        onRefresh={onRefresh}
      />
    );

    expect(screen.queryByText(/API:/)).not.toBeInTheDocument();
  });
});
