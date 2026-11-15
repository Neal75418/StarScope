/**
 * 寫入類操作（加入、取消追蹤…）失敗時給使用者看的一句話：做成了沒、為什麼、接下來怎麼辦。
 */

import { ApiError } from "../api/types";
import { API_ERROR_MESSAGES } from "../constants/api";
import { interpolate } from "../i18n";
import type { TranslationKeys } from "../i18n/translations";

interface WriteFailureCopy {
  /** 確定沒有做成時的那一句（例如「沒有加入追蹤清單。」） */
  notDone: string;
  /** 等不到回應時的整句：伺服器可能已經做完，不能說沒有做成 */
  timedOut: string;
  /** 對象在 GitHub 上找不到時的整句；沒給就當成一般失敗 */
  goneFromGitHub?: string;
}

/** 前端自己等到逾時（不是伺服器回的錯誤）：請求可能還在伺服器上跑 */
export function isRequestTimeout(error: unknown): boolean {
  return (
    error instanceof ApiError && error.status === 0 && error.detail === API_ERROR_MESSAGES.TIMED_OUT
  );
}

/**
 * 原因與下一步。只認後端用狀態碼與 code 分得出來的幾種，其餘回 null——後端的原始訊息是英文內部用語，
 * 不直接給使用者看。
 */
function knownCause(error: ApiError, t: TranslationKeys): string | null {
  if (error.status === 429) {
    return error.code === "LOCAL_RATE_LIMIT"
      ? t.failure.tooManyRequests
      : t.failure.githubRateLimit;
  }
  // 502 是 sidecar 對 GitHub 那一端失敗的統一回應；授權失效與被拒絕另有 code，要給不同於「稍後再試」的說法
  if (error.status === 502) {
    if (error.code === "GITHUB_AUTH_FAILED") return t.failure.githubAuth;
    if (error.code === "GITHUB_FORBIDDEN") return t.failure.githubForbidden;
    return t.failure.githubUnavailable;
  }
  if (error.status === 0 && error.detail.startsWith(API_ERROR_MESSAGES.NETWORK_ERROR)) {
    return t.failure.engineUnreachable;
  }
  return null;
}

export function describeWriteFailure(
  error: unknown,
  t: TranslationKeys,
  copy: WriteFailureCopy
): string {
  let cause: string | null = null;
  if (error instanceof ApiError) {
    if (isRequestTimeout(error)) return copy.timedOut;
    // 本機找不到那一列也是 404，但只有 GitHub 那一端找不到才帶這個 code
    const goneFromGitHub = error.status === 404 && error.code === "GITHUB_NOT_FOUND";
    if (goneFromGitHub && copy.goneFromGitHub !== undefined) return copy.goneFromGitHub;
    cause = knownCause(error, t);
  }
  return interpolate(t.failure.withCause, {
    outcome: copy.notDone,
    cause: cause ?? t.failure.retry,
  });
}
