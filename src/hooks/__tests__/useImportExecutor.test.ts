/**
 * useImportExecutor 測試：匯入落地後必須 invalidate repos query，
 * 否則清單要等 staleTime 過期才會出現剛匯入的 repo。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useImportExecutor } from "../useImportExecutor";
import { executeImportFlow } from "../../utils/importExecutorHelpers";
import type { ParsedRepo } from "../../utils/importHelpers";

vi.mock("../../utils/importExecutorHelpers", () => ({
  executeImportFlow: vi.fn(),
}));

const invalidateReposMock = vi.hoisted(() => vi.fn());
vi.mock("../../contexts/WatchlistContext", () => ({
  useWatchlistActions: () => ({ invalidateRepos: invalidateReposMock }),
}));

function makeParsed(fullName: string): ParsedRepo {
  const [owner, name] = fullName.split("/");
  return { owner, name, fullName, status: "pending" };
}

describe("useImportExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("有 repo 匯入成功時 invalidate repos query", async () => {
    vi.mocked(executeImportFlow).mockResolvedValue({
      success: 2,
      skipped: 0,
      failed: 0,
      dedupCheckFailed: false,
    });

    const { result } = renderHook(() =>
      useImportExecutor({
        parsedRepos: [makeParsed("a/one"), makeParsed("a/two")],
        setParsedRepos: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.startImport();
    });

    expect(invalidateReposMock).toHaveBeenCalledTimes(1);
    expect(result.current.result).toMatchObject({ total: 2, success: 2 });
  });

  it("全部失敗（success=0）時不 invalidate", async () => {
    vi.mocked(executeImportFlow).mockResolvedValue({
      success: 0,
      skipped: 0,
      failed: 1,
      dedupCheckFailed: false,
    });

    const { result } = renderHook(() =>
      useImportExecutor({
        parsedRepos: [makeParsed("a/one")],
        setParsedRepos: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.startImport();
    });

    expect(invalidateReposMock).not.toHaveBeenCalled();
  });
});
