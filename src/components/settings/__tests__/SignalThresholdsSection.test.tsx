import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "../../../lib/react-query";

const mockGetSignalThresholds = vi.fn();
const mockUpdateSignalThresholds = vi.fn();

vi.mock("../../../api/client", () => ({
  getSignalThresholds: (...args: unknown[]) => mockGetSignalThresholds(...args),
  updateSignalThresholds: (...args: unknown[]) => mockUpdateSignalThresholds(...args),
}));

import { SignalThresholdsSection } from "../SignalThresholdsSection";

const DEFAULTS = {
  rising_star_min_velocity: 10,
  sudden_spike_multiplier: 3,
  breakout_velocity_threshold: 2,
  viral_hn_min_score: 100,
};

function createWrapper() {
  const client = createTestQueryClient();
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

describe("SignalThresholdsSection", () => {
  const mockOnToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSignalThresholds.mockResolvedValue(DEFAULTS);
  });

  it("renders fields with default values after loading", async () => {
    render(<SignalThresholdsSection onToast={mockOnToast} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByLabelText(/Rising Star/)).toHaveValue(10);
    });
    expect(screen.getByLabelText(/Sudden Spike/)).toHaveValue(3);
    expect(screen.getByLabelText(/Breakout/)).toHaveValue(2);
    expect(screen.getByLabelText(/Viral HN/)).toHaveValue(100);
  });

  it("save button is disabled when no changes", async () => {
    render(<SignalThresholdsSection onToast={mockOnToast} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByLabelText(/Rising Star/)).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /Save|儲存/ })).toBeDisabled();
  });

  it("calls updateSignalThresholds on save with changed values", async () => {
    const user = userEvent.setup();
    mockUpdateSignalThresholds.mockResolvedValue({});
    render(<SignalThresholdsSection onToast={mockOnToast} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByLabelText(/Rising Star/)).toBeInTheDocument();
    });

    const input = screen.getByLabelText(/Rising Star/);
    await user.clear(input);
    await user.type(input, "15");

    await user.click(screen.getByRole("button", { name: /Save|儲存/ }));

    await waitFor(() => {
      expect(mockUpdateSignalThresholds).toHaveBeenCalledWith(
        expect.objectContaining({ rising_star_min_velocity: 15 })
      );
    });
  });

  it("shows error toast and aborts when draft has NaN value", async () => {
    const user = userEvent.setup();
    render(<SignalThresholdsSection onToast={mockOnToast} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByLabelText(/Rising Star/)).toBeInTheDocument();
    });

    // Use fireEvent.change to bypass jsdom's type="number" sanitization
    // (user.type rejects alphabetic chars on number inputs in jsdom)
    const input = screen.getByLabelText(/Rising Star/);
    fireEvent.change(input, { target: { value: "abc" } });

    await user.click(screen.getByRole("button", { name: /Save|儲存/ }));

    expect(mockOnToast).toHaveBeenCalledWith(expect.any(String), "error");
    expect(mockUpdateSignalThresholds).not.toHaveBeenCalled();
  });

  it("calls updateSignalThresholds with DEFAULTS on reset", async () => {
    const user = userEvent.setup();
    mockUpdateSignalThresholds.mockResolvedValue({});
    render(<SignalThresholdsSection onToast={mockOnToast} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByLabelText(/Rising Star/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Reset|重置/ }));

    await waitFor(() => {
      expect(mockUpdateSignalThresholds).toHaveBeenCalledWith(DEFAULTS);
    });
  });

  it("shows success toast after successful save", async () => {
    const user = userEvent.setup();
    mockUpdateSignalThresholds.mockResolvedValue({});
    render(<SignalThresholdsSection onToast={mockOnToast} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByLabelText(/Rising Star/)).toBeInTheDocument();
    });

    const input = screen.getByLabelText(/Rising Star/);
    await user.clear(input);
    await user.type(input, "20");

    await user.click(screen.getByRole("button", { name: /Save|儲存/ }));

    await waitFor(() => {
      expect(mockOnToast).toHaveBeenCalledWith(expect.any(String), "success");
    });
  });

  it("shows error toast when API fails", async () => {
    const user = userEvent.setup();
    mockUpdateSignalThresholds.mockRejectedValue(new Error("Server error"));
    render(<SignalThresholdsSection onToast={mockOnToast} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByLabelText(/Rising Star/)).toBeInTheDocument();
    });

    const input = screen.getByLabelText(/Rising Star/);
    await user.clear(input);
    await user.type(input, "20");

    await user.click(screen.getByRole("button", { name: /Save|儲存/ }));

    await waitFor(() => {
      expect(mockOnToast).toHaveBeenCalledWith(expect.any(String), "error");
    });
  });
});
