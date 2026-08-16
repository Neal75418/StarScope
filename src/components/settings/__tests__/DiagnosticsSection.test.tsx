/**
 * DiagnosticsSection 元件測試。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { createTestQueryClient, queryKeys } from "../../../lib/react-query";

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../hooks/useSmartInterval", () => ({
  useSmartInterval: () => () => 60_000,
}));

const mockGetDiagnostics = vi.fn();
const mockGetGitHubConnectionStatus = vi.fn();
const mockGetRecentLogs = vi.fn();

vi.mock("../../../api/client", () => ({
  getDiagnostics: (...args: unknown[]) => mockGetDiagnostics(...args),
  getGitHubConnectionStatus: (...args: unknown[]) => mockGetGitHubConnectionStatus(...args),
  getRecentLogs: (...args: unknown[]) => mockGetRecentLogs(...args),
}));

import { DiagnosticsSection } from "../DiagnosticsSection";

const mockDiagnostics = {
  version: "0.4.0",
  db_path: "~/.starscope/starscope.db",
  db_size_mb: 5.2,
  total_repos: 10,
  total_snapshots: 150,
  last_snapshot_at: "2026-03-22T10:00:00Z",
  uptime_seconds: 3600,
  last_fetch_success: "2026-03-22T09:55:00Z",
  last_fetch_failure: null,
  last_fetch_error: null,
  last_alert_check: "2026-03-22T09:50:00Z",
  last_backup: "2026-03-22T02:00:00Z",
};

function createWrapper() {
  const client = createTestQueryClient();
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

describe("DiagnosticsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDiagnostics.mockResolvedValue(mockDiagnostics);
    mockGetGitHubConnectionStatus.mockResolvedValue({
      connected: true,
      rate_limit_remaining: 4500,
      rate_limit_total: 5000,
    });
  });

  it("renders version and db size after loading", async () => {
    render(<DiagnosticsSection />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("0.4.0")).toBeInTheDocument();
    });
    expect(screen.getByText("5.2 MB")).toBeInTheDocument();
  });

  it("renders rate limit when available", async () => {
    render(<DiagnosticsSection />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("4500 / 5000")).toBeInTheDocument();
    });
  });

  it("shows success feedback after log export", async () => {
    mockGetRecentLogs.mockResolvedValue({ logs: "some log content" });

    render(<DiagnosticsSection />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("0.4.0")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Export Logs|匯出日誌/));

    await waitFor(() => {
      expect(screen.getByText(/Export successful|匯出成功/)).toBeInTheDocument();
    });
  });

  it("shows empty feedback when no logs available", async () => {
    mockGetRecentLogs.mockResolvedValue({ logs: "" });

    render(<DiagnosticsSection />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("0.4.0")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Export Logs|匯出日誌/));

    await waitFor(() => {
      expect(screen.getByText(/No logs available|無日誌可匯出/)).toBeInTheDocument();
    });
  });

  it("shows error feedback when export fails", async () => {
    mockGetRecentLogs.mockRejectedValue(new Error("Server error"));

    render(<DiagnosticsSection />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("0.4.0")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Export Logs|匯出日誌/));

    await waitFor(() => {
      expect(screen.getByText(/Export failed|匯出失敗/)).toBeInTheDocument();
    });
  });

  it("shares the connection status query with the rest of the app", async () => {
    // 兩個消費端各用一把 key 時，同一支端點會被抓兩次——而它每次都實際打一趟
    // GitHub 驗證 token（實測 414ms 與 766ms），且 Diagnostics 還每分鐘輪詢一次。
    mockGetDiagnostics.mockResolvedValue({ sidecar: { status: "ok" } });
    mockGetGitHubConnectionStatus.mockResolvedValue({ connected: true });

    const qc = createTestQueryClient();
    function Probe() {
      useQuery({
        queryKey: queryKeys.connection.status(),
        queryFn: () => mockGetGitHubConnectionStatus(),
      });
      return null;
    }
    render(
      createElement(QueryClientProvider, { client: qc }, [
        createElement(DiagnosticsSection, { key: "d" }),
        createElement(Probe, { key: "p" }),
      ])
    );

    await waitFor(() => expect(mockGetGitHubConnectionStatus).toHaveBeenCalled());
    expect(mockGetGitHubConnectionStatus).toHaveBeenCalledTimes(1);
  });
});
