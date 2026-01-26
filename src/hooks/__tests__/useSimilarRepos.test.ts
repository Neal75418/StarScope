import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useSimilarRepos } from "../useSimilarRepos";
import * as apiClient from "../../api/client";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getSimilarRepos: vi.fn(),
    calculateRepoSimilarities: vi.fn(),
  };
});

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: {
      similarRepos: {
        loadError: "Failed to load similar repos",
      },
    },
  }),
}));

describe("useSimilarRepos", () => {
  const mockSimilarRepos: apiClient.SimilarRepo[] = [
    {
      repo_id: 2,
      full_name: "similar/repo",
      description: "A similar repo",
      language: "TypeScript",
      url: "https://github.com/similar/repo",
      similarity_score: 0.85,
      shared_topics: ["typescript", "react"],
      same_language: true,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.getSimilarRepos).mockReset();
    vi.mocked(apiClient.calculateRepoSimilarities).mockReset();
  });

  it("returns initial loading state", () => {
    vi.mocked(apiClient.getSimilarRepos).mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useSimilarRepos(1));

    expect(result.current.loading).toBe(true);
    expect(result.current.similar).toEqual([]);
    expect(result.current.error).toBe(null);
    expect(result.current.isRecalculating).toBe(false);
  });

  it("loads similar repos successfully", async () => {
    vi.mocked(apiClient.getSimilarRepos).mockResolvedValue({
      repo_id: 1,
      similar: mockSimilarRepos,
      total: 1,
    });

    const { result } = renderHook(() => useSimilarRepos(1));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.similar).toEqual(mockSimilarRepos);
    expect(result.current.error).toBe(null);
    expect(apiClient.getSimilarRepos).toHaveBeenCalledWith(1, 5);
  });

  it("handles API error", async () => {
    vi.mocked(apiClient.getSimilarRepos).mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useSimilarRepos(1));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to load similar repos");
    expect(result.current.similar).toEqual([]);
  });

  it("uses custom limit parameter", async () => {
    vi.mocked(apiClient.getSimilarRepos).mockResolvedValue({
      repo_id: 1,
      similar: mockSimilarRepos,
      total: 1,
    });

    renderHook(() => useSimilarRepos(1, 10));

    await waitFor(() => {
      expect(apiClient.getSimilarRepos).toHaveBeenCalledWith(1, 10);
    });
  });

  it("recalculates similarities", async () => {
    vi.mocked(apiClient.getSimilarRepos).mockResolvedValue({
      repo_id: 1,
      similar: mockSimilarRepos,
      total: 1,
    });
    vi.mocked(apiClient.calculateRepoSimilarities).mockResolvedValue({
      repo_id: 1,
      similarities_found: 5,
    });

    const { result } = renderHook(() => useSimilarRepos(1));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.recalculate();
    });

    expect(apiClient.calculateRepoSimilarities).toHaveBeenCalledWith(1);
  });

  it("handles recalculation error gracefully", async () => {
    vi.mocked(apiClient.getSimilarRepos).mockResolvedValue({
      repo_id: 1,
      similar: mockSimilarRepos,
      total: 1,
    });
    vi.mocked(apiClient.calculateRepoSimilarities).mockRejectedValue(new Error("Calculation failed"));

    const { result } = renderHook(() => useSimilarRepos(1));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.recalculate();
    });

    expect(result.current.isRecalculating).toBe(false);
  });
});
