import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useImport } from "../useImport";

vi.mock("../../utils/importHelpers", () => ({
  parseRepositories: vi.fn(),
  removeDuplicates: vi.fn((repos: unknown[]) => repos),
}));

vi.mock("../useImportExecutor", () => {
  const cancel = vi.fn();
  const setResult = vi.fn();
  return {
    useImportExecutor: () => ({
      isImporting: false,
      result: null,
      setResult,
      startImport: vi.fn(),
      cancelImport: cancel,
    }),
    __getMocks: () => ({ cancel, setResult }),
  };
});

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
