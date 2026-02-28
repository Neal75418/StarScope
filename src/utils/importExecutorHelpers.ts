/**
 * 匯入執行器輔助函式。
 */

import { addRepo, getRepos } from "../api/client";
import { ParsedRepo } from "./importHelpers";

/**
 * 執行儲存庫列表的匯入迴圈。
 */
async function runImportLoop(
  reposToProcess: ParsedRepo[],
  abortController: AbortController,
  existingSet: Set<string>,
  updateRepo: (fullName: string, updates: Partial<ParsedRepo>) => void,
  onProgress?: () => Promise<void>
): Promise<{ success: number; skipped: number; failed: number }> {
  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (const repo of reposToProcess) {
    if (abortController.signal.aborted) break;

    const outcome = await processSingleRepo(repo, abortController.signal, existingSet, updateRepo);

    if (outcome === "success") success++;
    else if (outcome === "skipped") skipped++;
    else if (outcome === "failed" && !abortController.signal.aborted) failed++;

    if (!abortController.signal.aborted && onProgress) {
      await onProgress();
    }
  }

  return { success, skipped, failed };
}

/**
 * 編排完整匯入流程：先取得現有儲存庫，再執行匯入迴圈。
 */
export async function executeImportFlow(
  parsedRepos: ParsedRepo[],
  abortController: AbortController,
  updateRepo: (fullName: string, updates: Partial<ParsedRepo>) => void
): Promise<{ success: number; skipped: number; failed: number }> {
  const existingSet = await fetchExistingRepoSet();

  return runImportLoop(
    parsedRepos,
    abortController,
    existingSet,
    updateRepo,
    async () => new Promise((resolve) => setTimeout(resolve, 500))
  );
}

async function fetchExistingRepoSet(): Promise<Set<string>> {
  try {
    const response = await getRepos();
    return new Set(response.repos.map((r) => r.full_name.toLowerCase()));
  } catch {
    return new Set();
  }
}

/**
 * 以指數退避重試執行非同步操作，用於處理 rate limit。
 */
async function executeWithRetry<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
  maxAttempts: number = 3
): Promise<T> {
  let lastError: Error = new Error("Failed");

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal.aborted) throw new Error("Aborted");

    try {
      return await operation();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      const errorMessage = lastError.message.toLowerCase();
      const isRateLimit = errorMessage.includes("rate") || errorMessage.includes("429");

      if (isRateLimit && attempt < maxAttempts - 1) {
        // 指數退避：2s、4s、8s...
        const delay = Math.pow(2, attempt + 1) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw lastError;
    }
  }
  throw lastError;
}

/**
 * 處理單一儲存庫的匯入。
 * 回傳結果狀態。
 */
async function processSingleRepo(
  repo: ParsedRepo,
  signal: AbortSignal,
  existingSet: Set<string>,
  updateRepo: (fullName: string, updates: Partial<ParsedRepo>) => void
): Promise<"success" | "skipped" | "failed"> {
  // 檢查是否已取消
  if (signal.aborted) return "failed";

  // 檢查是否重複
  if (existingSet.has(repo.fullName.toLowerCase())) {
    updateRepo(repo.fullName, { status: "skipped" });
    return "skipped";
  }

  // 標記為匯入中
  updateRepo(repo.fullName, { status: "importing" });

  try {
    await executeWithRetry(() => addRepo({ owner: repo.owner, name: repo.name }), signal);

    updateRepo(repo.fullName, { status: "success" });
    existingSet.add(repo.fullName.toLowerCase());
    return "success";
  } catch (err) {
    if (!signal.aborted) {
      const errorMessage = err instanceof Error ? err.message : "Failed";
      updateRepo(repo.fullName, { status: "error", error: errorMessage });
    }
    return "failed";
  }
}
