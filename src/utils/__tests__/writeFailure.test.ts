/**
 * describeWriteFailure 的單元測試：每一種失敗各給哪一句。
 */

import { describe, it, expect } from "vitest";
import { describeWriteFailure, isEngineUnreachable, isRequestTimeout } from "../writeFailure";
import { ApiError } from "../../api/types";
import { API_ERROR_MESSAGES } from "../../constants/api";
import { getTranslations } from "../../i18n";

const t = getTranslations("en");
const describeFailure = (error: unknown) => describeWriteFailure(error, t, t.discovery.addFailed);

describe("describeWriteFailure", () => {
  it("says GitHub's quota is used up when GitHub rate-limits the request", () => {
    const error = new ApiError(429, "GitHub API rate limit exceeded.", "GITHUB_RATE_LIMIT");

    expect(describeFailure(error)).toBe(
      "Not added to your watchlist. GitHub's API quota is used up. Try again later."
    );
  });

  it("blames the pace, not GitHub, when the app's own limiter rejects the request", () => {
    const error = new ApiError(429, "Rate limit exceeded: 5 per 1 minute", "LOCAL_RATE_LIMIT");

    expect(describeFailure(error)).toBe(
      "Not added to your watchlist. Too many requests in a short time. Wait a moment and try again."
    );
  });

  it("does not promise that waiting helps when GitHub returns an error or is unreachable", () => {
    const error = new ApiError(502, "Upstream service unreachable");

    expect(describeFailure(error)).toBe(
      "Not added to your watchlist. GitHub returned an error or couldn't be reached. Try again later."
    );
  });

  it("sends the user to reconnect when GitHub rejects the saved sign-in", () => {
    // 授權失效時等再久也不會好：不能和暫時性的失敗用同一句「稍後再試」
    const error = new ApiError(
      502,
      "GitHub API error: GitHub API authentication failed - check token",
      "GITHUB_AUTH_FAILED"
    );

    expect(describeFailure(error)).toBe(
      "Not added to your watchlist. GitHub rejected the saved sign-in — it may have expired or been revoked. Reconnect GitHub in Settings."
    );
  });

  it("names both possible reasons when GitHub refuses the action", () => {
    // 非限流的 403 多半是權限或封鎖，但 GitHub 的次級限流也可能不帶限流標頭而落在這裡：
    // 兩種都要講，不能只指向權限
    const error = new ApiError(502, "GitHub API error: GitHub API forbidden", "GITHUB_FORBIDDEN");

    expect(describeFailure(error)).toBe(
      "Not added to your watchlist. GitHub refused this action — it may be a permissions problem or too many requests in a short time. Try again in a minute; if it keeps happening, check the GitHub connection in Settings."
    );
  });

  it("says the repository can't be found on GitHub when GitHub is the one that can't find it", () => {
    const error = new ApiError(404, "Resource not found: PUT star a/one", "GITHUB_NOT_FOUND");

    expect(describeFailure(error)).toBe(t.discovery.addFailed.goneFromGitHub);
  });

  it("does not blame GitHub for a 404 that did not come from GitHub", () => {
    // 本機找不到那一列也是 404，但不帶 GITHUB_NOT_FOUND
    const error = new ApiError(404, "Repository not found");

    expect(describeFailure(error)).toBe("Not added to your watchlist. Try again.");
  });

  it("treats a GitHub 404 as an ordinary failure when the caller has no sentence for it", () => {
    const error = new ApiError(404, "Resource not found", "GITHUB_NOT_FOUND");

    expect(
      describeWriteFailure(error, t, {
        notDone: "Not saved.",
        timedOut: "Unclear whether it saved.",
      })
    ).toBe("Not saved. Try again.");
  });

  it("does not claim it failed when the request timed out", () => {
    // 等不到回應時伺服器可能已經做完
    const error = new ApiError(0, API_ERROR_MESSAGES.TIMED_OUT);

    expect(describeFailure(error)).toBe(t.discovery.addFailed.timedOut);
  });

  it("says the data engine can't be reached when the request never got through", () => {
    const error = new ApiError(0, "Network error: Failed to fetch");

    expect(describeFailure(error)).toBe(
      "Not added to your watchlist. The data engine can't be reached."
    );
  });

  it.each([
    ["a server error", new ApiError(500, "Internal Server Error")],
    ["a rejected input", new ApiError(400, "Invalid repository name")],
    ["a cancelled request", new ApiError(0, API_ERROR_MESSAGES.CANCELLED)],
    ["something that is not an API error", new Error("boom")],
    ["a thrown string", "boom"],
  ])("falls back to a plain retry hint for %s", (_label, error) => {
    expect(describeFailure(error)).toBe("Not added to your watchlist. Try again.");
  });

  it("never shows the backend's raw message", () => {
    const error = new ApiError(502, "GitHub API error: 401 Bad credentials");

    expect(describeFailure(error)).not.toContain("Bad credentials");
  });

  it("joins the two sentences the way each language writes them", () => {
    // 中文句號後面不留空白
    const zh = getTranslations("zh-TW");
    const error = new ApiError(429, "GitHub API rate limit exceeded.", "GITHUB_RATE_LIMIT");

    expect(describeWriteFailure(error, zh, zh.discovery.addFailed)).toBe(
      "沒有加入追蹤清單。GitHub API 配額用完了，稍後再試。"
    );
    expect(describeWriteFailure(new Error("boom"), zh, zh.discovery.unstarFailed)).toBe(
      "沒有取消追蹤。請再試一次。"
    );
  });
});

describe("isEngineUnreachable", () => {
  it("is true when the request never reached the engine", () => {
    expect(isEngineUnreachable(new ApiError(0, "Network error: Load failed"))).toBe(true);
  });

  // 伺服器回了錯誤、或只是慢：引擎連得到
  it.each([
    ["a timeout", new ApiError(0, "Request timed out")],
    ["a server error", new ApiError(500, "Internal server error")],
    ["a 503", new ApiError(503, "Service unavailable")],
    ["a client error", new ApiError(400, "Bad request")],
    ["a plain error", new Error("Network error: Load failed")],
  ])("is false for %s", (_label, error) => {
    expect(isEngineUnreachable(error)).toBe(false);
  });
});

describe("isRequestTimeout", () => {
  it("is true only for the client-side timeout", () => {
    expect(isRequestTimeout(new ApiError(0, API_ERROR_MESSAGES.TIMED_OUT))).toBe(true);
    expect(isRequestTimeout(new ApiError(0, "Network error: Failed to fetch"))).toBe(false);
    expect(isRequestTimeout(new ApiError(504, API_ERROR_MESSAGES.TIMED_OUT))).toBe(false);
    expect(isRequestTimeout(new Error(API_ERROR_MESSAGES.TIMED_OUT))).toBe(false);
  });
});
