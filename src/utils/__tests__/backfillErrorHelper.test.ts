/**
 * 回填丟出例外時給使用者看的一句話：後端的原字不上畫面，伺服器錯誤與逾時不說成離線。
 */

import { describe, it, expect } from "vitest";
import { getBackfillErrorMessage } from "../backfillErrorHelper";
import { ApiError } from "../../api/client";
import { API_ERROR_MESSAGES } from "../../constants/api";
import { interpolate } from "../../i18n";
import { translations } from "../../i18n/translations";

const t = translations.en;
const notDone = (cause: string) =>
  interpolate(t.failure.withCause, { outcome: t.starHistory.backfillFailure.notDone, cause });

describe("getBackfillErrorMessage", () => {
  it("says it is unclear whether a timed-out backfill finished", () => {
    const error = new ApiError(0, API_ERROR_MESSAGES.TIMED_OUT);
    expect(getBackfillErrorMessage(error, t)).toBe(t.starHistory.backfillFailure.timedOut);
  });

  it("says the engine can't be reached when the request never got there", () => {
    const error = new ApiError(0, `${API_ERROR_MESSAGES.NETWORK_ERROR}: Failed to fetch`);
    expect(getBackfillErrorMessage(error, t)).toBe(notDone(t.failure.engineUnreachable));
  });

  it("does not call a server error being offline", () => {
    const error = new ApiError(500, "Internal server error");
    expect(getBackfillErrorMessage(error, t)).toBe(notDone(t.failure.retry));
  });

  it("says GitHub can't find the repository", () => {
    const error = new ApiError(404, "Repository not found on GitHub", "GITHUB_NOT_FOUND");
    expect(getBackfillErrorMessage(error, t)).toBe(t.starHistory.backfillFailure.goneFromGitHub);
  });

  it("gives the GitHub-side cause it can tell from the code", () => {
    const error = new ApiError(502, "GitHub authentication failed", "GITHUB_AUTH_FAILED");
    expect(getBackfillErrorMessage(error, t)).toBe(notDone(t.failure.githubAuth));
  });

  it("tells the two rate limits apart", () => {
    expect(
      getBackfillErrorMessage(new ApiError(429, "Too many requests", "LOCAL_RATE_LIMIT"), t)
    ).toBe(notDone(t.failure.tooManyRequests));
    expect(getBackfillErrorMessage(new ApiError(429, "GitHub rate limit exceeded"), t)).toBe(
      notDone(t.failure.githubRateLimit)
    );
  });

  it("does not show the server's own words", () => {
    const error = new ApiError(400, "Invalid repository format");
    expect(getBackfillErrorMessage(error, t)).toBe(notDone(t.failure.retry));
  });

  it("falls back to a plain retry for errors that aren't from the API", () => {
    expect(getBackfillErrorMessage(new Error("Some error"), t)).toBe(notDone(t.failure.retry));
    expect(getBackfillErrorMessage("string error", t)).toBe(notDone(t.failure.retry));
  });
});
