import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "../../../lib/react-query";
import { TrendsBatchAddBar } from "../TrendsBatchAddBar";
import type { TrendingRepo } from "../../../api/client";

const mockBatchAddRepos = vi.fn();

vi.mock("../../../api/client", () => ({
  batchAddRepos: (...args: unknown[]) => mockBatchAddRepos(...args),
}));

function makeTrending(id: number, fullName: string): TrendingRepo {
  const [owner, name] = fullName.split("/");
  return {
    id,
    owner,
    name,
    full_name: fullName,
    url: `https://github.com/${fullName}`,
    description: null,
    language: null,
    stars: 1000,
    stars_delta_7d: 100,
    stars_delta_30d: 400,
    velocity: 14.3,
    acceleration: 1.0,
    trend: 1,
    forks_delta_7d: null,
    forks_delta_30d: null,
    issues_delta_7d: null,
    issues_delta_30d: null,
    rank: id,
  };
}

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = createTestQueryClient();
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("TrendsBatchAddBar", () => {
  beforeEach(() => {
    mockBatchAddRepos.mockReset();
  });

  it("renders nothing when selectedCount is 0", () => {
    const { container } = renderWithQuery(
      <TrendsBatchAddBar selectedRepos={[]} selectedCount={0} onDone={vi.fn()} onError={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders selected count and buttons when repos are selected", () => {
    renderWithQuery(
      <TrendsBatchAddBar
        selectedRepos={[makeTrending(1, "a/b")]}
        selectedCount={1}
        onDone={vi.fn()}
        onError={vi.fn()}
      />
    );
    expect(screen.getByTestId("trends-batch-bar")).toBeInTheDocument();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByText("Add 1 to Watchlist")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("calls batchAddRepos and onDone on success", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    mockBatchAddRepos.mockResolvedValue({ success: 2, failed: 0, total: 2 });

    renderWithQuery(
      <TrendsBatchAddBar
        selectedRepos={[makeTrending(1, "a/b"), makeTrending(2, "c/d")]}
        selectedCount={2}
        onDone={onDone}
        onError={vi.fn()}
      />
    );

    await user.click(screen.getByTestId("trends-batch-add-btn"));

    await waitFor(() => {
      expect(mockBatchAddRepos).toHaveBeenCalledWith([
        { owner: "a", name: "b" },
        { owner: "c", name: "d" },
      ]);
      expect(onDone).toHaveBeenCalled();
    });
  });

  it("calls onError with partial message when some fail", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const onError = vi.fn();
    mockBatchAddRepos.mockResolvedValue({ success: 1, failed: 1, total: 2 });

    renderWithQuery(
      <TrendsBatchAddBar
        selectedRepos={[makeTrending(1, "a/b"), makeTrending(2, "c/d")]}
        selectedCount={2}
        onDone={onDone}
        onError={onError}
      />
    );

    await user.click(screen.getByTestId("trends-batch-add-btn"));

    await waitFor(() => {
      // Partial failure: stay in selection mode, show error, don't call onDone
      expect(onDone).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith("Added 1 of 2 repos");
    });
  });

  it("calls onError without onDone when all repos fail", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const onError = vi.fn();
    mockBatchAddRepos.mockResolvedValue({ success: 0, failed: 2, total: 2 });

    renderWithQuery(
      <TrendsBatchAddBar
        selectedRepos={[makeTrending(1, "a/b"), makeTrending(2, "c/d")]}
        selectedCount={2}
        onDone={onDone}
        onError={onError}
      />
    );

    await user.click(screen.getByTestId("trends-batch-add-btn"));

    await waitFor(() => {
      expect(onDone).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith("Failed to add repos to watchlist");
    });
  });

  it("calls onError on API failure", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    mockBatchAddRepos.mockRejectedValue(new Error("Network error"));

    renderWithQuery(
      <TrendsBatchAddBar
        selectedRepos={[makeTrending(1, "a/b")]}
        selectedCount={1}
        onDone={vi.fn()}
        onError={onError}
      />
    );

    await user.click(screen.getByTestId("trends-batch-add-btn"));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith("Failed to add repos to watchlist");
    });
  });

  it("calls onDone when cancel is clicked", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();

    renderWithQuery(
      <TrendsBatchAddBar
        selectedRepos={[makeTrending(1, "a/b")]}
        selectedCount={1}
        onDone={onDone}
        onError={vi.fn()}
      />
    );

    await user.click(screen.getByText("Cancel"));
    expect(onDone).toHaveBeenCalled();
  });

  it("disables cancel button while adding", async () => {
    const user = userEvent.setup();
    mockBatchAddRepos.mockReturnValue(new Promise(() => {})); // never resolves

    renderWithQuery(
      <TrendsBatchAddBar
        selectedRepos={[makeTrending(1, "a/b")]}
        selectedCount={1}
        onDone={vi.fn()}
        onError={vi.fn()}
      />
    );

    await user.click(screen.getByTestId("trends-batch-add-btn"));

    expect(screen.getByText("Cancel")).toBeDisabled();
  });

  it("disables add button while adding", async () => {
    const user = userEvent.setup();
    let resolvePromise: ((value: unknown) => void) | undefined;
    mockBatchAddRepos.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );

    renderWithQuery(
      <TrendsBatchAddBar
        selectedRepos={[makeTrending(1, "a/b")]}
        selectedCount={1}
        onDone={vi.fn()}
        onError={vi.fn()}
      />
    );

    await user.click(screen.getByTestId("trends-batch-add-btn"));

    expect(screen.getByTestId("trends-batch-add-btn")).toBeDisabled();
    expect(screen.getByText("Adding...")).toBeInTheDocument();

    // Resolve to clean up
    resolvePromise?.({ success: 1, failed: 0, total: 1 });
  });
});
