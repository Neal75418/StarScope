/**
 * 匯入執行器輔助函式。
 */

import { addRepo, getRepos } from "../api/client";
import { ApiError } from "../api/types";
import type { TranslationKeys } from "../i18n/translations";
import type { ParsedRepo } from "./importHelpers";
import { normalizeRepoName } from "./format";
import { logger } from "./logger";
import { describeWriteFailure, isRequestTimeout } from "./writeFailure";

/** 匯入逐筆之間的延遲（毫秒），避免 API 過載。 */
const IMPORT_ITEM_DELAY_MS = 500;

/** 匯入的計數。uncertain：等不到回應的筆數（不算失敗），伺服器可能晚一點才加完，呼叫端要接著定期重讀 */
export interface ImportOutcome {
  success: number;
  skipped: number;
  failed: number;
  uncertain: number;
}

/**
 * 執行儲存庫列表的匯入迴圈。
 */
async function runImportLoop(
  reposToProcess: ParsedRepo[],
  abortController: AbortController,
  existingSet: Set<string>,
  updateRepo: (fullName: string, updates: Partial<ParsedRepo>) => void,
  t: TranslationKeys,
  onProgress?: () => Promise<void>
): Promise<ImportOutcome> {
  let success = 0;
  let skipped = 0;
  let failed = 0;
  let uncertain = 0;

  for (const repo of reposToProcess) {
    if (abortController.signal.aborted) break;

    const outcome = await processSingleRepo(
      repo,
      abortController.signal,
      existingSet,
      updateRepo,
      t
    );

    if (outcome === "success") success++;
    else if (outcome === "skipped") skipped++;
    else if (!abortController.signal.aborted) {
      if (outcome === "uncertain") uncertain++;
      else failed++;
    }

    if (!abortController.signal.aborted && onProgress) {
      try {
        await onProgress();
      } catch {
        // abortableDelay 在延遲窗口內被取消會 reject。這裡必須帶著已累積的
        // 計數正常返回，不能讓 reject 穿出去：呼叫端靠回傳值決定要不要
        // invalidate（取消前已成功的 repo 一樣進了後端）
        break;
      }
    }
  }

  return { success, skipped, failed, uncertain };
}

/**
 * 編排完整匯入流程：先取得現有儲存庫，再執行匯入迴圈。
 */
export async function executeImportFlow(
  parsedRepos: ParsedRepo[],
  abortController: AbortController,
  updateRepo: (fullName: string, updates: Partial<ParsedRepo>) => void,
  t: TranslationKeys
): Promise<ImportOutcome> {
  const existingSet = await fetchExistingRepoSet(abortController.signal);

  return runImportLoop(parsedRepos, abortController, existingSet, updateRepo, t, async () =>
    abortableDelay(IMPORT_ITEM_DELAY_MS, abortController.signal)
  );
}

/**
 * 預先去重用的既有清單：省請求。讀不到時照樣逐筆送，已經在追蹤的由後端回 ALREADY_TRACKED、歸成略過
 * （後端認得大小寫不同與改名前的舊名）。
 */
async function fetchExistingRepoSet(signal?: AbortSignal): Promise<Set<string>> {
  try {
    const response = await getRepos(signal);
    return new Set(response.repos.map((r) => normalizeRepoName(r.full_name)));
  } catch (err) {
    if (!signal?.aborted) logger.warn("[Import] 取得現有 repos 進行去重檢查失敗:", err);
    return new Set();
  }
}

/**
 * Abort-aware delay：可被 AbortSignal 中斷的延遲。
 */
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Aborted"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
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
        await abortableDelay(delay, signal);
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
  updateRepo: (fullName: string, updates: Partial<ParsedRepo>) => void,
  t: TranslationKeys
): Promise<"success" | "skipped" | "failed" | "uncertain"> {
  // 檢查是否已取消
  if (signal.aborted) return "failed";

  // 檢查是否重複
  if (existingSet.has(normalizeRepoName(repo.fullName))) {
    // 重試整份清單時，上一輪的說明（例如等不到回應）不能留在這一列
    updateRepo(repo.fullName, { status: "skipped", error: undefined });
    return "skipped";
  }

  // 標記為匯入中，清掉上一輪的說明：之後的成功／略過不會再碰 error（updateRepo 是合併）
  updateRepo(repo.fullName, { status: "importing", error: undefined });

  try {
    await executeWithRetry(() => addRepo({ owner: repo.owner, name: repo.name }), signal);

    updateRepo(repo.fullName, { status: "success" });
    existingSet.add(normalizeRepoName(repo.fullName));
    return "success";
  } catch (err) {
    if (signal.aborted) return "failed";
    // 已經在追蹤清單＝使用者要的結果，不是失敗
    if (err instanceof ApiError && err.code === "ALREADY_TRACKED") {
      updateRepo(repo.fullName, { status: "skipped" });
      existingSet.add(normalizeRepoName(repo.fullName));
      return "skipped";
    }
    // 等不到回應：伺服器可能晚一點才做完，不能說失敗
    if (isRequestTimeout(err)) {
      updateRepo(repo.fullName, { status: "uncertain", error: t.discovery.addFailed.timedOut });
      return "uncertain";
    }
    // 後端的原始訊息是英文內部用語，不上畫面
    updateRepo(repo.fullName, {
      status: "error",
      error: describeWriteFailure(err, t, t.discovery.addFailed),
    });
    return "failed";
  }
}
