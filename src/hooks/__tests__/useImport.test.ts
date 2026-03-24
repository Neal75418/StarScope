import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useImport } from "../useImport";

vi.mock("../../utils/importHelpers", () => ({
  parseRepositories: vi.fn(),
  removeDuplicates: vi.fn((repos: unknown[]) => repos),
}));

const mockCancel = vi.fn();
const mockSetResult = vi.fn();
const mockStartImport = vi.fn();

vi.mock("../useImportExecutor", () => ({
  useImportExecutor: () => ({
    isImporting: false,
    result: null,
    setResult: mockSetResult,
    startImport: mockStartImport,
    cancelImport: mockCancel,
  }),
}));

import { parseRepositories } from "../../utils/importHelpers";
import type { ParsedRepo } from "../../utils/importHelpers";

function makeParsed(fullName: string): ParsedRepo {
  const [owner, name] = fullName.split("/");
  return { owner, name, fullName, status: "pending" };
}

describe("useImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct initial state", () => {
    const { result } = renderHook(() => useImport());

    expect(result.current.parsedRepos).toEqual([]);
    expect(result.current.parseError).toBeNull();
    expect(result.current.isImporting).toBe(false);
    expect(result.current.result).toBeNull();
  });

  it("parseText sets parsedRepos on success", () => {
    const parsed = [makeParsed("a/b"), makeParsed("c/d")];
    vi.mocked(parseRepositories).mockReturnValue(parsed);

    const { result } = renderHook(() => useImport());

    act(() => {
      result.current.parseText("a/b\nc/d");
    });

    expect(parseRepositories).toHaveBeenCalledWith("a/b\nc/d");
    expect(result.current.parsedRepos).toEqual(parsed);
    expect(result.current.parseError).toBeNull();
  });

  it("parseText sets parseError when no repos found", () => {
    vi.mocked(parseRepositories).mockReturnValue([]);

    const { result } = renderHook(() => useImport());

    act(() => {
      result.current.parseText("");
    });

    expect(result.current.parseError).not.toBeNull();
    expect(result.current.parsedRepos).toEqual([]);
  });

  it("parseText clears previous parsedRepos and error", () => {
    // First: parse valid text
    vi.mocked(parseRepositories).mockReturnValue([makeParsed("a/b")]);
    const { result } = renderHook(() => useImport());

    act(() => {
      result.current.parseText("a/b");
    });
    expect(result.current.parsedRepos).toHaveLength(1);

    // Second: parse empty text → should clear old parsedRepos and set error
    vi.mocked(parseRepositories).mockReturnValue([]);
    act(() => {
      result.current.parseText("");
    });

    expect(result.current.parsedRepos).toEqual([]);
    expect(result.current.parseError).not.toBeNull();
  });

  it("startImport delegates to executor", () => {
    vi.mocked(parseRepositories).mockReturnValue([makeParsed("a/b")]);
    const { result } = renderHook(() => useImport());

    act(() => {
      result.current.parseText("a/b");
    });

    act(() => {
      result.current.startImport();
    });

    expect(mockStartImport).toHaveBeenCalled();
  });

  it("reset clears parsedRepos, parseError, and result", () => {
    vi.mocked(parseRepositories).mockReturnValue([makeParsed("a/b")]);

    const { result } = renderHook(() => useImport());

    // Parse some text to populate parsedRepos
    act(() => {
      result.current.parseText("a/b");
    });
    expect(result.current.parsedRepos).toHaveLength(1);

    // Reset should clear everything
    act(() => {
      result.current.reset();
    });
    expect(result.current.parsedRepos).toHaveLength(0);
    expect(result.current.parseError).toBeNull();

    expect(mockCancel).toHaveBeenCalled();
  });

  it("reset clears parseError from a failed parse", () => {
    vi.mocked(parseRepositories).mockReturnValue([]);

    const { result } = renderHook(() => useImport());

    // Parse empty text → sets parseError
    act(() => {
      result.current.parseText("");
    });
    expect(result.current.parseError).not.toBeNull();

    // Reset should clear it
    act(() => {
      result.current.reset();
    });
    expect(result.current.parseError).toBeNull();
  });
});
