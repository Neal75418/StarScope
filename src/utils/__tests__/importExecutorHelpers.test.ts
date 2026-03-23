/**
 * importExecutorHelpers 單元測試 — executeImportFlow、重試、中止、去重
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeImportFlow } from "../importExecutorHelpers";
import * as apiClient from "../../api/client";
import type { ParsedRepo } from "../importHelpers";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    addRepo: vi.fn(),
    getRepos: vi.fn(),
  };
});

vi.mock("../logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

function makeParsedRepo(fullName: string): ParsedRepo {
  const [owner, name] = fullName.split("/");
  return { owner, name, fullName, status: "pending" };
}

describe("executeImportFlow", () => {
  const updateRepo = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.getRepos).mockResolvedValue({
      repos: [],
      total: 0,
    } as never);
    vi.mocked(apiClient.addRepo).mockResolvedValue(undefined as never);
  });

  // ==================== 正常流程 ====================

  it("imports all repos successfully", async () => {
    const repos = [makeParsedRepo("owner/repo1"), makeParsedRepo("owner/repo2")];

    const result = await executeImportFlow(repos, new AbortController(), updateRepo);

    expect(result.success).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.dedupCheckFailed).toBe(false);
    expect(apiClient.addRepo).toHaveBeenCalledTimes(2);
  });

  it("skips repos that already exist", async () => {
    vi.mocked(apiClient.getRepos).mockResolvedValue({
      repos: [{ full_name: "owner/existing" }],
      total: 1,
    } as never);

    const repos = [makeParsedRepo("owner/existing"), makeParsedRepo("owner/new")];

    const result = await executeImportFlow(repos, new AbortController(), updateRepo);

    expect(result.success).toBe(1);
    expect(result.skipped).toBe(1);
    expect(apiClient.addRepo).toHaveBeenCalledTimes(1);
    expect(updateRepo).toHaveBeenCalledWith("owner/existing", { status: "skipped" });
  });

  it("counts failed repos", async () => {
    vi.mocked(apiClient.addRepo).mockRejectedValue(new Error("Server error"));

    const repos = [makeParsedRepo("owner/fail")];

    const result = await executeImportFlow(repos, new AbortController(), updateRepo);

    expect(result.success).toBe(0);
    expect(result.failed).toBe(1);
    expect(updateRepo).toHaveBeenCalledWith("owner/fail", {
      status: "error",
      error: "Server error",
    });
  });

  it("marks repo as 'importing' before API call", async () => {
    const repos = [makeParsedRepo("owner/repo")];

    await executeImportFlow(repos, new AbortController(), updateRepo);

    // First updateRepo call should be "importing"
    expect(updateRepo.mock.calls[0]).toEqual(["owner/repo", { status: "importing" }]);
  });

  // ==================== 去重檢查失敗 ====================

  it("returns dedupCheckFailed=true when getRepos fails", async () => {
    vi.mocked(apiClient.getRepos).mockRejectedValue(new Error("Network error"));

    const repos = [makeParsedRepo("owner/repo")];

    const result = await executeImportFlow(repos, new AbortController(), updateRepo);

    expect(result.dedupCheckFailed).toBe(true);
    // Should still attempt to import (with empty existing set)
    expect(result.success).toBe(1);
  });

  it("returns dedupCheckFailed=false when getRepos succeeds", async () => {
    const repos = [makeParsedRepo("owner/repo")];
    const result = await executeImportFlow(repos, new AbortController(), updateRepo);
    expect(result.dedupCheckFailed).toBe(false);
  });

  // ==================== 去重大小寫不敏感 ====================

  it("dedup check is case-insensitive", async () => {
    vi.mocked(apiClient.getRepos).mockResolvedValue({
      repos: [{ full_name: "Owner/Repo" }],
      total: 1,
    } as never);

    const repos = [makeParsedRepo("owner/repo")];

    const result = await executeImportFlow(repos, new AbortController(), updateRepo);

    expect(result.skipped).toBe(1);
    expect(apiClient.addRepo).not.toHaveBeenCalled();
  });

  // ==================== 中止 ====================

  it("stops processing when aborted before starting", async () => {
    const controller = new AbortController();
    controller.abort();

    const repos = [makeParsedRepo("owner/repo1"), makeParsedRepo("owner/repo2")];

    const result = await executeImportFlow(repos, controller, updateRepo);

    expect(result.success).toBe(0);
    expect(apiClient.addRepo).not.toHaveBeenCalled();
  });

  it("stops processing mid-import when aborted", async () => {
    const controller = new AbortController();

    vi.mocked(apiClient.addRepo).mockImplementation(async () => {
      // Abort after the first successful import
      controller.abort();
      return undefined as never;
    });

    const repos = [
      makeParsedRepo("owner/repo1"),
      makeParsedRepo("owner/repo2"),
      makeParsedRepo("owner/repo3"),
    ];

    const result = await executeImportFlow(repos, controller, updateRepo);

    // First repo succeeds, then abort triggers
    expect(result.success).toBe(1);
    // Second and third should not be fully processed
    expect(apiClient.addRepo).toHaveBeenCalledTimes(1);
  });

  it("abort during dedup fetch stops import", async () => {
    const controller = new AbortController();

    vi.mocked(apiClient.getRepos).mockImplementation(async () => {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });

    const repos = [makeParsedRepo("owner/repo1")];
    const result = await executeImportFlow(repos, controller, updateRepo);

    // Aborted during dedup — should not proceed to import
    expect(result.success).toBe(0);
    expect(apiClient.addRepo).not.toHaveBeenCalled();
    // Abort is not a dedup error
    expect(result.dedupCheckFailed).toBe(false);
  });

  it("abort during retry backoff stops immediately", async () => {
    vi.useFakeTimers();

    const controller = new AbortController();

    vi.mocked(apiClient.addRepo).mockRejectedValue(new Error("rate limit exceeded"));

    const repos = [makeParsedRepo("owner/repo")];
    const promise = executeImportFlow(repos, controller, updateRepo);

    // Rate limit hit, waiting for backoff delay — abort during wait
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    await vi.advanceTimersByTimeAsync(5000);

    const result = await promise;

    // Aborted during backoff — not counted as failed (abort guard in runImportLoop)
    expect(result.success).toBe(0);
    expect(result.failed).toBe(0);
    // Only the initial attempt, no retry after abort
    expect(apiClient.addRepo).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  // ==================== Rate limit 重試 ====================

  it("retries on rate limit error with exponential backoff", async () => {
    vi.useFakeTimers();

    vi.mocked(apiClient.addRepo)
      .mockRejectedValueOnce(new Error("rate limit exceeded"))
      .mockResolvedValueOnce(undefined as never);

    const repos = [makeParsedRepo("owner/repo")];

    const promise = executeImportFlow(repos, new AbortController(), updateRepo);

    // Fast-forward past the retry delay (2s for first retry)
    await vi.advanceTimersByTimeAsync(2500);

    const result = await promise;

    expect(result.success).toBe(1);
    expect(apiClient.addRepo).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("retries on 429 error", async () => {
    vi.useFakeTimers();

    vi.mocked(apiClient.addRepo)
      .mockRejectedValueOnce(new Error("429 Too Many Requests"))
      .mockResolvedValueOnce(undefined as never);

    const repos = [makeParsedRepo("owner/repo")];

    const promise = executeImportFlow(repos, new AbortController(), updateRepo);

    await vi.advanceTimersByTimeAsync(2500);

    const result = await promise;

    expect(result.success).toBe(1);

    vi.useRealTimers();
  });

  // ==================== 混合結果 ====================

  it("handles mix of success, skip, and failure", async () => {
    vi.mocked(apiClient.getRepos).mockResolvedValue({
      repos: [{ full_name: "owner/existing" }],
      total: 1,
    } as never);

    vi.mocked(apiClient.addRepo)
      .mockResolvedValueOnce(undefined as never) // repo1 succeeds
      .mockRejectedValueOnce(new Error("fail")); // repo3 fails

    const repos = [
      makeParsedRepo("owner/repo1"),
      makeParsedRepo("owner/existing"),
      makeParsedRepo("owner/repo3"),
    ];

    const result = await executeImportFlow(repos, new AbortController(), updateRepo);

    expect(result.success).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("adds successfully imported repos to existing set for subsequent dedup", async () => {
    vi.mocked(apiClient.addRepo).mockResolvedValue(undefined as never);

    // Two repos with the same name — second one should be imported too
    // since they're different entries, but if we import owner/repo first,
    // it gets added to existingSet, so a duplicate later would be skipped.
    const repos = [makeParsedRepo("owner/repo"), makeParsedRepo("owner/repo")];

    const result = await executeImportFlow(repos, new AbortController(), updateRepo);

    // First succeeds, second should be skipped (added to existingSet after first)
    expect(result.success).toBe(1);
    expect(result.skipped).toBe(1);
    expect(apiClient.addRepo).toHaveBeenCalledTimes(1);
  });
});
