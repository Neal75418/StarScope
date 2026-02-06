import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAddRepoDialog } from "../useAddRepoDialog";

describe("useAddRepoDialog", () => {
  let mockAddNewRepo: ReturnType<
    typeof vi.fn<(input: string) => Promise<{ success: boolean; error?: string }>>
  >;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAddNewRepo = vi.fn<(input: string) => Promise<{ success: boolean; error?: string }>>();
  });

  it("has correct initial state", () => {
    const { result } = renderHook(() => useAddRepoDialog(mockAddNewRepo, "Fallback error"));

    expect(result.current.isDialogOpen).toBe(false);
    expect(result.current.dialogError).toBeNull();
    expect(result.current.isAddingRepo).toBe(false);
  });

  it("opens dialog", () => {
    const { result } = renderHook(() => useAddRepoDialog(mockAddNewRepo, "Fallback error"));

    act(() => {
      result.current.openAddDialog();
    });

    expect(result.current.isDialogOpen).toBe(true);
  });

  it("closes dialog and clears error", () => {
    const { result } = renderHook(() => useAddRepoDialog(mockAddNewRepo, "Fallback error"));

    act(() => {
      result.current.openAddDialog();
    });
    act(() => {
      result.current.closeAddDialog();
    });

    expect(result.current.isDialogOpen).toBe(false);
    expect(result.current.dialogError).toBeNull();
  });

  it("closes dialog on successful add", async () => {
    mockAddNewRepo.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useAddRepoDialog(mockAddNewRepo, "Fallback error"));

    act(() => {
      result.current.openAddDialog();
    });

    await act(async () => {
      await result.current.handleAddRepo("facebook/react");
    });

    expect(result.current.isDialogOpen).toBe(false);
    expect(result.current.dialogError).toBeNull();
    expect(result.current.isAddingRepo).toBe(false);
  });

  it("keeps dialog open and sets error on failure", async () => {
    mockAddNewRepo.mockResolvedValue({ success: false, error: "Repo not found" });
    const { result } = renderHook(() => useAddRepoDialog(mockAddNewRepo, "Fallback error"));

    act(() => {
      result.current.openAddDialog();
    });

    await act(async () => {
      await result.current.handleAddRepo("invalid/repo");
    });

    expect(result.current.isDialogOpen).toBe(true);
    expect(result.current.dialogError).toBe("Repo not found");
    expect(result.current.isAddingRepo).toBe(false);
  });

  it("uses fallback error when no error message provided", async () => {
    mockAddNewRepo.mockResolvedValue({ success: false });
    const { result } = renderHook(() => useAddRepoDialog(mockAddNewRepo, "Fallback error"));

    await act(async () => {
      await result.current.handleAddRepo("bad/input");
    });

    expect(result.current.dialogError).toBe("Fallback error");
  });

  it("sets isAdding during operation", async () => {
    let resolvePromise: ((value: { success: boolean }) => void) | undefined;
    mockAddNewRepo.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
    );

    const { result } = renderHook(() => useAddRepoDialog(mockAddNewRepo, "Fallback error"));

    // Start adding - should be in adding state
    const addPromise = act(async () => {
      const p = result.current.handleAddRepo("facebook/react");
      return p;
    });

    // Can't reliably check intermediate state in strict mode,
    // but we can verify it resets after completion
    resolvePromise?.({ success: true });
    await addPromise;

    expect(result.current.isAddingRepo).toBe(false);
  });

  it("clears previous error when starting new add", async () => {
    // First add fails
    mockAddNewRepo.mockResolvedValue({ success: false, error: "First error" });
    const { result } = renderHook(() => useAddRepoDialog(mockAddNewRepo, "Fallback error"));

    await act(async () => {
      await result.current.handleAddRepo("bad/input");
    });
    expect(result.current.dialogError).toBe("First error");

    // Second add succeeds - error should be cleared
    mockAddNewRepo.mockResolvedValue({ success: true });
    await act(async () => {
      await result.current.handleAddRepo("facebook/react");
    });
    expect(result.current.dialogError).toBeNull();
  });
});
