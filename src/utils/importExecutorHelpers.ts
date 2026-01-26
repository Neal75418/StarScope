import { addRepo, getRepos } from "../api/client";
import { ParsedRepo } from "./importHelpers";

/**
 * Run the import loop for a list of repos.
 */
export async function runImportLoop(
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
 * orchestrates the whole import flow: fetching existing repos, then running the loop.
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

export async function fetchExistingRepoSet(): Promise<Set<string>> {
  try {
    const response = await getRepos();
    return new Set(response.repos.map((r) => r.full_name.toLowerCase()));
  } catch {
    return new Set();
  }
}

/**
 * Execute an async operation with exponential backoff retry for rate limits.
 */
export async function executeWithRetry<T>(
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
        // Exponential backoff: 2s, 4s, 8s...
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
 * Process a single repository import.
 * Returns the outcome status.
 */
export async function processSingleRepo(
  repo: ParsedRepo,
  signal: AbortSignal,
  existingSet: Set<string>,
  updateRepo: (fullName: string, updates: Partial<ParsedRepo>) => void
): Promise<"success" | "skipped" | "failed"> {
  // Check cancellation
  if (signal.aborted) return "failed";

  // Check duplicate
  if (existingSet.has(repo.fullName.toLowerCase())) {
    updateRepo(repo.fullName, { status: "skipped" });
    return "skipped";
  }

  // Mark importing
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
