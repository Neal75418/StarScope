import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { BackfillControls } from "../BackfillControls";
import { TranslationKeys } from "../../i18n";

const mockT = {
  starHistory: {
    backfill: "Backfill",
    backfilling: "Backfilling...",
    maxStars: "Max {count} stars",
    offlineNoBackfill: "Cannot backfill while offline",
  },
  common: {
    retry: "Retry",
  },
} as unknown as TranslationKeys;

describe("BackfillControls", () => {
  const defaultProps = {
    handleBackfill: vi.fn(),
    loadStatus: vi.fn(),
    backfilling: false,
    isOffline: false,
    loading: false,
    maxStars: 5000,
    t: mockT,
  };

  it("renders backfill button", () => {
    render(<BackfillControls {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Backfill" })).toBeInTheDocument();
  });

  it("shows backfilling text when backfilling", () => {
    render(<BackfillControls {...defaultProps} backfilling={true} />);
    expect(screen.getByRole("button", { name: "Backfilling..." })).toBeInTheDocument();
  });

  it("disables button when backfilling", () => {
    render(<BackfillControls {...defaultProps} backfilling={true} />);
    expect(screen.getByRole("button", { name: "Backfilling..." })).toBeDisabled();
  });

  it("disables button when offline", () => {
    render(<BackfillControls {...defaultProps} isOffline={true} />);
    expect(screen.getByRole("button", { name: "Backfill" })).toBeDisabled();
  });

  it("shows maxStars tooltip when online", () => {
    render(<BackfillControls {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Backfill" })).toHaveAttribute(
      "title",
      "Max 5000 stars"
    );
  });

  it("shows offline tooltip when offline", () => {
    render(<BackfillControls {...defaultProps} isOffline={true} />);
    expect(screen.getByRole("button", { name: "Backfill" })).toHaveAttribute(
      "title",
      "Cannot backfill while offline"
    );
  });

  it("calls handleBackfill when clicked", async () => {
    const user = userEvent.setup();
    const handleBackfill = vi.fn();
    render(<BackfillControls {...defaultProps} handleBackfill={handleBackfill} />);

    await user.click(screen.getByRole("button", { name: "Backfill" }));
    expect(handleBackfill).toHaveBeenCalled();
  });

  it("shows retry button when offline", () => {
    render(<BackfillControls {...defaultProps} isOffline={true} />);
    expect(screen.getByRole("button", { name: "↻" })).toBeInTheDocument();
  });

  it("hides retry button when online", () => {
    render(<BackfillControls {...defaultProps} isOffline={false} />);
    expect(screen.queryByRole("button", { name: "↻" })).not.toBeInTheDocument();
  });

  it("calls loadStatus when retry clicked", async () => {
    const user = userEvent.setup();
    const loadStatus = vi.fn();
    render(<BackfillControls {...defaultProps} isOffline={true} loadStatus={loadStatus} />);

    await user.click(screen.getByRole("button", { name: "↻" }));
    expect(loadStatus).toHaveBeenCalled();
  });

  it("shows loading state on retry button", () => {
    render(<BackfillControls {...defaultProps} isOffline={true} loading={true} />);
    expect(screen.getByRole("button", { name: "..." })).toBeInTheDocument();
  });

  it("disables retry button when loading", () => {
    render(<BackfillControls {...defaultProps} isOffline={true} loading={true} />);
    expect(screen.getByRole("button", { name: "..." })).toBeDisabled();
  });
});
