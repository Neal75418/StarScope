import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRemoveConfirm } from "../useRemoveConfirm";
import { RepoWithSignals } from "../../api/client";

const mockRepos: RepoWithSignals[] = [
  {
    id: 1,
    owner: "facebook",
    name: "react",
    full_name: "facebook/react",
    url: "https://github.com/facebook/react",
    description: "A library",
    language: "JavaScript",
    added_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    stars: 200000,
    forks: 40000,
    stars_delta_7d: 100,
    stars_delta_30d: 400,
    velocity: 14.3,
    acceleration: 0.5,
    trend: 1,
    last_fetched: "2024-01-01T00:00:00Z",
  },
  {
    id: 2,
    owner: "vuejs",
    name: "vue",
    full_name: "vuejs/vue",
    url: "https://github.com/vuejs/vue",
    description: "Vue.js",
    language: "TypeScript",
    added_at: "2024-01-02T00:00:00Z",
    updated_at: "2024-01-02T00:00:00Z",
    stars: 200000,
    forks: 30000,
    stars_delta_7d: 50,
    stars_delta_30d: 200,
    velocity: 7.0,
    acceleration: 0.2,
    trend: 1,
    last_fetched: "2024-01-02T00:00:00Z",
  },
];

describe("useRemoveConfirm", () => {
  let mockDeleteRepo: ReturnType<typeof vi.fn<(repoId: number) => Promise<boolean>>>;
  let mockToast: {
    success: ReturnType<typeof vi.fn<(msg: string) => void>>;
    error: ReturnType<typeof vi.fn<(msg: string) => void>>;
  };
  const messages = { success: "已移除", error: "移除失敗" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteRepo = vi.fn<(repoId: number) => Promise<boolean>>();
    mockToast = { success: vi.fn<(msg: string) => void>(), error: vi.fn<(msg: string) => void>() };
  });

  it("has correct initial state", () => {
    const { result } = renderHook(() =>
      useRemoveConfirm(mockRepos, mockDeleteRepo, mockToast, messages)
    );

    expect(result.current.removeConfirm.isOpen).toBe(false);
    expect(result.current.removeConfirm.repoId).toBeNull();
    expect(result.current.removeConfirm.repoName).toBe("");
  });

  it("opens confirm dialog with correct repo name", () => {
    const { result } = renderHook(() =>
      useRemoveConfirm(mockRepos, mockDeleteRepo, mockToast, messages)
    );

    act(() => {
      result.current.openRemoveConfirm(1);
    });

    expect(result.current.removeConfirm.isOpen).toBe(true);
    expect(result.current.removeConfirm.repoId).toBe(1);
    expect(result.current.removeConfirm.repoName).toBe("facebook/react");
  });

  it("uses empty name when repo not found", () => {
    const { result } = renderHook(() =>
      useRemoveConfirm(mockRepos, mockDeleteRepo, mockToast, messages)
    );

    act(() => {
      result.current.openRemoveConfirm(999);
    });

    expect(result.current.removeConfirm.isOpen).toBe(true);
    expect(result.current.removeConfirm.repoName).toBe("");
  });

  it("closes confirm dialog and resets state", () => {
    const { result } = renderHook(() =>
      useRemoveConfirm(mockRepos, mockDeleteRepo, mockToast, messages)
    );

    act(() => {
      result.current.openRemoveConfirm(1);
    });
    act(() => {
      result.current.closeRemoveConfirm();
    });

    expect(result.current.removeConfirm.isOpen).toBe(false);
    expect(result.current.removeConfirm.repoId).toBeNull();
  });

  it("shows success toast on successful delete", async () => {
    mockDeleteRepo.mockResolvedValue(true);
    const { result } = renderHook(() =>
      useRemoveConfirm(mockRepos, mockDeleteRepo, mockToast, messages)
    );

    act(() => {
      result.current.openRemoveConfirm(1);
    });

    await act(async () => {
      await result.current.confirmRemoveRepo();
    });

    expect(mockDeleteRepo).toHaveBeenCalledWith(1);
    expect(mockToast.success).toHaveBeenCalledWith("已移除");
    expect(result.current.removeConfirm.isOpen).toBe(false);
  });

  it("shows error toast on failed delete", async () => {
    mockDeleteRepo.mockResolvedValue(false);
    const { result } = renderHook(() =>
      useRemoveConfirm(mockRepos, mockDeleteRepo, mockToast, messages)
    );

    act(() => {
      result.current.openRemoveConfirm(1);
    });

    await act(async () => {
      await result.current.confirmRemoveRepo();
    });

    expect(mockToast.error).toHaveBeenCalledWith("移除失敗");
    expect(result.current.removeConfirm.isOpen).toBe(false);
  });

  it("does nothing when confirming without repoId", async () => {
    const { result } = renderHook(() =>
      useRemoveConfirm(mockRepos, mockDeleteRepo, mockToast, messages)
    );

    await act(async () => {
      await result.current.confirmRemoveRepo();
    });

    expect(mockDeleteRepo).not.toHaveBeenCalled();
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
  });
});
