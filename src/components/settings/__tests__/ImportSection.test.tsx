/**
 * Regression tests for ImportSection — starred import partial failure flow.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ImportSection } from "../ImportSection";
import { createTestQueryClient } from "../../../lib/react-query";
import type { StarredRepo, BatchImportResult } from "../../../api/types";

// Mock useStarredImport
let mockStarred: Record<string, unknown>;

vi.mock("../../../hooks/useStarredImport", () => ({
  useStarredImport: () => mockStarred,
}));

// Mock useImport (text/file import — not under test)
vi.mock("../../../hooks/useImport", () => ({
  useImport: () => ({
    parsedRepos: [],
    isImporting: false,
    result: null,
    parseError: null,
    parseFile: vi.fn(),
    parseText: vi.fn(),
    startImport: vi.fn(),
    reset: vi.fn(),
  }),
}));

// Mock GitHub connection status — connected
vi.mock("../../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/client")>();
  return {
    ...actual,
    getGitHubConnectionStatus: vi.fn().mockResolvedValue({ connected: true }),
  };
});

const makeStarredRepo = (name: string): StarredRepo => ({
  owner: name.split("/")[0],
  name: name.split("/")[1],
  full_name: name,
  description: null,
  language: "TypeScript",
  stars: 100,
  url: `https://github.com/${name}`,
  topics: [],
});

function renderSection() {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <ImportSection />
    </QueryClientProvider>
  );
}

describe("ImportSection — starred import partial failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStarred = {
      starredRepos: [],
      isLoading: false,
      error: null,
      fetchStarred: vi.fn(),
      selectedRepos: new Set<string>(),
      toggleRepo: vi.fn(),
      selectAll: vi.fn(),
      deselectAll: vi.fn(),
      startImport: vi.fn(),
      isImporting: false,
      result: null,
      importError: null,
      reset: vi.fn(),
      hasFetched: false,
    };
  });

  it("keeps selection list visible when starred import has failures", async () => {
    const repos = [makeStarredRepo("org/repo-a"), makeStarredRepo("org/repo-b")];
    const result: BatchImportResult = {
      total: 2,
      success: 1,
      skipped: 0,
      failed: 1,
      errors: ["repo-b: rate limited"],
    };

    mockStarred = {
      ...mockStarred,
      hasFetched: true,
      starredRepos: repos,
      selectedRepos: new Set(["org/repo-b"]),
      result,
    };

    renderSection();

    // Wait for GitHub connection query to resolve (enables starred import UI)
    await waitFor(() => {
      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    // Selection list checkboxes should still be visible for retry
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBe(2);

    // Repo names in the selection list
    expect(screen.getByText("org/repo-a")).toBeInTheDocument();
    expect(screen.getByText("org/repo-b")).toBeInTheDocument();
  });

  it("shows terminal result view when all items succeed", async () => {
    const result: BatchImportResult = {
      total: 2,
      success: 2,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    mockStarred = {
      ...mockStarred,
      hasFetched: true,
      starredRepos: [makeStarredRepo("org/repo-a"), makeStarredRepo("org/repo-b")],
      selectedRepos: new Set<string>(),
      result,
    };

    renderSection();

    // Wait for GitHub connection query to resolve
    await waitFor(() => {
      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    // Selection list should NOT be visible — terminal state
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
});
