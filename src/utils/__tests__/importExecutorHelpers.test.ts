/**
 * importExecutorHelpers 單元測試 — executeImportFlow、重試、中止、去重
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeImportFlow } from "../importExecutorHelpers";
import * as apiClient from "../../api/client";
import type { ParsedRepo } from "../importHelpers";
import { ApiError } from "../../api/types";
import { API_ERROR_MESSAGES } from "../../constants/api";
import { interpolate } from "../../i18n";
import { translations } from "../../i18n/translations";

const t = translations.en;

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

    const result = await executeImportFlow(repos, new AbortController(), updateRepo, t);

    expect(result.success).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.uncertain).toBe(0);
    expect(apiClient.addRepo).toHaveBeenCalledTimes(2);
  });

  it("skips repos that already exist", async () => {
    vi.mocked(apiClient.getRepos).mockResolvedValue({
      repos: [{ full_name: "owner/existing" }],
      total: 1,
    } as never);

    const repos = [makeParsedRepo("owner/existing"), makeParsedRepo("owner/new")];

    const result = await executeImportFlow(repos, new AbortController(), updateRepo, t);

    expect(result.success).toBe(1);
    expect(result.skipped).toBe(1);
    expect(apiClient.addRepo).toHaveBeenCalledTimes(1);
    expect(updateRepo).toHaveBeenCalledWith("owner/existing", { status: "skipped" });
  });

  it("counts failed repos", async () => {
    vi.mocked(apiClient.addRepo).mockRejectedValue(new ApiError(500, "Server error"));

    const repos = [makeParsedRepo("owner/fail")];

    const result = await executeImportFlow(repos, new AbortController(), updateRepo, t);

    expect(result.success).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.uncertain).toBe(0);
    // 後端的原字不上畫面
    expect(updateRepo).toHaveBeenCalledWith("owner/fail", {
      status: "error",
      error: interpolate(t.failure.withCause, {
        outcome: t.discovery.addFailed.notDone,
        cause: t.failure.retry,
      }),
    });
    expect(JSON.stringify(updateRepo.mock.calls)).not.toContain("Server error");
  });

  it("marks repo as 'importing' before API call", async () => {
    const repos = [makeParsedRepo("owner/repo")];

    await executeImportFlow(repos, new AbortController(), updateRepo, t);

    // First updateRepo call should be "importing"
    expect(updateRepo.mock.calls[0]).toEqual(["owner/repo", { status: "importing" }]);
  });

  // ==================== 去重檢查失敗 ====================

  it("still imports when the existing list can't be read, and the server sorts out the ones already tracked", async () => {
    vi.mocked(apiClient.getRepos).mockRejectedValue(new Error("Network error"));
    vi.mocked(apiClient.addRepo)
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(
        new ApiError(400, "Repository owner/old is already in your watchlist", "ALREADY_TRACKED")
      );

    const repos = [makeParsedRepo("owner/new"), makeParsedRepo("owner/old")];
    const result = await executeImportFlow(repos, new AbortController(), updateRepo, t);

    expect(result).toMatchObject({ success: 1, skipped: 1, failed: 0 });
    expect(updateRepo).toHaveBeenCalledWith("owner/old", { status: "skipped" });
  });

  // ==================== 失敗的說明 ====================

  it("says why an add failed in the app's words, not the server's", async () => {
    vi.mocked(apiClient.addRepo).mockRejectedValue(
      new ApiError(404, "Repository not found on GitHub", "GITHUB_NOT_FOUND")
    );

    const result = await executeImportFlow(
      [makeParsedRepo("owner/gone")],
      new AbortController(),
      updateRepo,
      t
    );

    expect(result.failed).toBe(1);
    expect(updateRepo).toHaveBeenCalledWith("owner/gone", {
      status: "error",
      error: t.discovery.addFailed.goneFromGitHub,
    });
  });

  it("gives the cause it can tell from the status code", async () => {
    vi.mocked(apiClient.addRepo).mockRejectedValue(
      new ApiError(502, "GitHub authentication failed", "GITHUB_AUTH_FAILED")
    );

    await executeImportFlow([makeParsedRepo("owner/repo")], new AbortController(), updateRepo, t);

    expect(updateRepo).toHaveBeenCalledWith("owner/repo", {
      status: "error",
      error: interpolate(t.failure.withCause, {
        outcome: t.discovery.addFailed.notDone,
        cause: t.failure.githubAuth,
      }),
    });
  });

  it("does not count a timed-out add as failed: it may still go through", async () => {
    vi.mocked(apiClient.addRepo).mockRejectedValue(new ApiError(0, API_ERROR_MESSAGES.TIMED_OUT));

    const result = await executeImportFlow(
      [makeParsedRepo("owner/slow")],
      new AbortController(),
      updateRepo,
      t
    );

    expect(result).toMatchObject({ success: 0, failed: 0, uncertain: 1 });
    expect(updateRepo).toHaveBeenCalledWith("owner/slow", {
      status: "uncertain",
      error: t.discovery.addFailed.timedOut,
    });
  });

  // ==================== 去重大小寫不敏感 ====================

  it("dedup check is case-insensitive", async () => {
    vi.mocked(apiClient.getRepos).mockResolvedValue({
      repos: [{ full_name: "Owner/Repo" }],
      total: 1,
    } as never);

    const repos = [makeParsedRepo("owner/repo")];

    const result = await executeImportFlow(repos, new AbortController(), updateRepo, t);

    expect(result.skipped).toBe(1);
    expect(apiClient.addRepo).not.toHaveBeenCalled();
  });

  // ==================== 中止 ====================

  it("stops processing when aborted before starting", async () => {
    const controller = new AbortController();
    controller.abort();

    const repos = [makeParsedRepo("owner/repo1"), makeParsedRepo("owner/repo2")];

    const result = await executeImportFlow(repos, controller, updateRepo, t);

    expect(result.success).toBe(0);
    expect(apiClient.addRepo).not.toHaveBeenCalled();
  });

  it("abort 落在批次間延遲窗口時仍正常返回計數（不 reject）", async () => {
    // 取消最常落在每筆之間的 500ms abortableDelay 裡：delay reject 不能穿出
    // executeImportFlow，否則呼叫端拿不到計數、無法為已成功的那些 invalidate
    const controller = new AbortController();
    const abortingUpdateRepo = vi.fn((_name: string, updates: Partial<ParsedRepo>) => {
      // 第一筆標成 success 後，用 macrotask 取消：microtask 會搶在 aborted 守衛
      // 之前生效、走不進 delay；macrotask 保證 abortableDelay 已經開始等
      if (updates.status === "success") setTimeout(() => controller.abort(), 0);
    });

    const repos = [makeParsedRepo("owner/repo1"), makeParsedRepo("owner/repo2")];
    const result = await executeImportFlow(repos, controller, abortingUpdateRepo, t);

    expect(result.success).toBe(1);
    expect(apiClient.addRepo).toHaveBeenCalledTimes(1);
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

    const result = await executeImportFlow(repos, controller, updateRepo, t);

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
    const result = await executeImportFlow(repos, controller, updateRepo, t);

    // Aborted during dedup — should not proceed to import
    expect(result.success).toBe(0);
    expect(apiClient.addRepo).not.toHaveBeenCalled();
    // Abort is not a dedup error
  });

  it("abort during retry backoff stops immediately", async () => {
    vi.useFakeTimers();

    const controller = new AbortController();

    vi.mocked(apiClient.addRepo).mockRejectedValue(new Error("rate limit exceeded"));

    const repos = [makeParsedRepo("owner/repo")];
    const promise = executeImportFlow(repos, controller, updateRepo, t);

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

    const promise = executeImportFlow(repos, new AbortController(), updateRepo, t);

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

    const promise = executeImportFlow(repos, new AbortController(), updateRepo, t);

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

    const result = await executeImportFlow(repos, new AbortController(), updateRepo, t);

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

    const result = await executeImportFlow(repos, new AbortController(), updateRepo, t);

    // First succeeds, second should be skipped (added to existingSet after first)
    expect(result.success).toBe(1);
    expect(result.skipped).toBe(1);
    expect(apiClient.addRepo).toHaveBeenCalledTimes(1);
  });
});

describe("importing the same list again", () => {
  // 畫面上的 updateRepo 是 {...r, ...updates} 合併：上一輪的說明沒清掉的話，✓ 旁邊還留著「沒有加入」
  function mergingRows(repos: ParsedRepo[]) {
    const rows = new Map(repos.map((r) => [r.fullName, { ...r }]));
    const update = (fullName: string, updates: Partial<ParsedRepo>) => {
      const row = rows.get(fullName);
      if (row) rows.set(fullName, { ...row, ...updates });
    };
    return { rows, update };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.getRepos).mockResolvedValue({ repos: [], total: 0 } as never);
  });

  it("clears a failure's note when the retry goes through", async () => {
    const repos = [makeParsedRepo("o/fail")];
    const { rows, update } = mergingRows(repos);
    vi.mocked(apiClient.addRepo).mockRejectedValueOnce(new ApiError(500, "Server error"));
    await executeImportFlow(repos, new AbortController(), update, t);
    expect(rows.get("o/fail")?.status).toBe("error");

    vi.mocked(apiClient.addRepo).mockResolvedValueOnce(undefined as never);
    await executeImportFlow(repos, new AbortController(), update, t);

    expect(rows.get("o/fail")?.status).toBe("success");
    expect(rows.get("o/fail")?.error).toBeUndefined();
  });

  it("clears an unclear note when the retry finds it was added after all", async () => {
    const repos = [makeParsedRepo("o/slow")];
    const { rows, update } = mergingRows(repos);
    vi.mocked(apiClient.addRepo).mockRejectedValueOnce(
      new ApiError(0, API_ERROR_MESSAGES.TIMED_OUT)
    );
    await executeImportFlow(repos, new AbortController(), update, t);
    expect(rows.get("o/slow")?.status).toBe("uncertain");

    // 伺服器後來做完了：這次預查就看到它
    vi.mocked(apiClient.getRepos).mockResolvedValue({
      repos: [{ full_name: "o/slow" }],
      total: 1,
    } as never);
    await executeImportFlow(repos, new AbortController(), update, t);

    expect(rows.get("o/slow")?.status).toBe("skipped");
    expect(rows.get("o/slow")?.error).toBeUndefined();
  });
});
