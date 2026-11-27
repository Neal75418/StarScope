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
const keepRefetchingMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/react-query")>()),
  keepRefetchingAfterTimeout: keepRefetchingMock,
}));
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
      uncertain: 0,
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

  it("有 repo 加入失敗時也 invalidate：失敗後一律重讀受影響的資料", async () => {
    vi.mocked(executeImportFlow).mockResolvedValue({
      success: 0,
      skipped: 0,
      failed: 1,
      uncertain: 0,
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

    expect(invalidateReposMock).toHaveBeenCalledTimes(1);
    expect(keepRefetchingMock).not.toHaveBeenCalled();
  });

  it("有 repo 等不到回應時，接下來一陣子定期重讀：伺服器可能晚一點才加完", async () => {
    vi.mocked(executeImportFlow).mockResolvedValue({
      success: 0,
      skipped: 0,
      failed: 0,
      uncertain: 1,
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

    expect(invalidateReposMock).toHaveBeenCalledTimes(1);
    expect(keepRefetchingMock).toHaveBeenCalledWith(invalidateReposMock);
  });

  it("全部略過時不 invalidate：清單沒有變", async () => {
    vi.mocked(executeImportFlow).mockResolvedValue({
      success: 0,
      skipped: 1,
      failed: 0,
      uncertain: 0,
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
