import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  useAddRepoMutation,
  useRemoveRepoMutation,
  useFetchRepoMutation,
  useRefreshAllMutation,
} from "../useRepoMutations";
import * as apiClient from "../../../api/client";
import { createTestQueryClient } from "../../../lib/react-query";

vi.mock("../../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/client")>();
  return {
    ...actual,
    addRepo: vi.fn(),
    removeRepo: vi.fn(),
    fetchRepo: vi.fn(),
    fetchAllRepos: vi.fn(),
    getRepos: vi.fn(),
  };
});

const fakeRepo: apiClient.RepoWithSignals = {
  id: 1,
  owner: "facebook",
  name: "react",
  full_name: "facebook/react",
  url: "https://github.com/facebook/react",
  description: "A JavaScript library",
  language: "JavaScript",
  added_at: "2024-01-15T00:00:00Z",
  updated_at: "2024-01-15T00:00:00Z",
  stars: 200000,
  forks: 40000,
  stars_delta_7d: 100,
  stars_delta_30d: 400,
  velocity: 14.3,
  acceleration: 0.5,
  trend: 1,
  last_fetched: "2024-01-15T00:00:00Z",
};

function createWrapper() {
  const client = createTestQueryClient();
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

describe("useAddRepoMutation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls addRepo API and returns data on success", async () => {
    vi.mocked(apiClient.addRepo).mockResolvedValue(fakeRepo);

    const { result } = renderHook(() => useAddRepoMutation(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ owner: "facebook", name: "react" });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(apiClient.addRepo).toHaveBeenCalledWith(
      { owner: "facebook", name: "react" },
      expect.anything()
    );
    expect(result.current.data).toEqual(fakeRepo);
  });

  it("sets error on API failure", async () => {
    vi.mocked(apiClient.addRepo).mockRejectedValue(new Error("Conflict"));

    const { result } = renderHook(() => useAddRepoMutation(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ owner: "x", name: "y" });
    });

    await waitFor(() => {
      expect(result.current.error?.message).toBe("Conflict");
    });
  });
});

describe("useRemoveRepoMutation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls removeRepo API with repoId", async () => {
    vi.mocked(apiClient.removeRepo).mockResolvedValue(undefined);

    const { result } = renderHook(() => useRemoveRepoMutation(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(42);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(apiClient.removeRepo).toHaveBeenCalledWith(42, expect.anything());
  });

  it("sets error on failure", async () => {
    vi.mocked(apiClient.removeRepo).mockRejectedValue(new Error("Not found"));

    const { result } = renderHook(() => useRemoveRepoMutation(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(99);
    });

    await waitFor(() => {
      expect(result.current.error?.message).toBe("Not found");
    });
  });
});

describe("useFetchRepoMutation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls fetchRepo API and returns updated repo", async () => {
    const updated = { ...fakeRepo, stars: 210000 };
    vi.mocked(apiClient.fetchRepo).mockResolvedValue(updated);

    const { result } = renderHook(() => useFetchRepoMutation(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(1);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(apiClient.fetchRepo).toHaveBeenCalledWith(1, expect.anything());
    expect(result.current.data?.stars).toBe(210000);
  });
});

describe("useRefreshAllMutation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls fetchAllRepos API", async () => {
    vi.mocked(apiClient.fetchAllRepos).mockResolvedValue({
      repos: [fakeRepo],
      total: 1,
    });

    const { result } = renderHook(() => useRefreshAllMutation(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(apiClient.fetchAllRepos).toHaveBeenCalled();
  });

  it("sets error on failure", async () => {
    vi.mocked(apiClient.fetchAllRepos).mockRejectedValue(new Error("Server error"));

    const { result } = renderHook(() => useRefreshAllMutation(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => {
      expect(result.current.error?.message).toBe("Server error");
    });
  });
});
