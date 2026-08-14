/**
 * useInterests hook 測試：讀取與 CRUD mutations。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useInterests } from "../useInterests";
import * as apiClient from "../../api/client";
import { createTestQueryClient } from "../../lib/react-query";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getInterests: vi.fn(),
    createInterest: vi.fn(),
    deleteInterest: vi.fn(),
    getExclusions: vi.fn(),
    addExclusion: vi.fn(),
    removeExclusion: vi.fn(),
  };
});

function createWrapper() {
  const client = createTestQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.getInterests).mockResolvedValue({
    interests: [{ id: 1, term: "tauri", kind: "topic", weight: 3 }],
  });
  vi.mocked(apiClient.getExclusions).mockResolvedValue({
    exclusions: [{ id: 1, term: "awesome" }],
  });
});

describe("useInterests", () => {
  it("loads interests and exclusions", async () => {
    const { result } = renderHook(() => useInterests(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.interests).toHaveLength(1));
    expect(result.current.exclusions[0].term).toBe("awesome");
  });

  it("create calls the API with the given input", async () => {
    vi.mocked(apiClient.createInterest).mockResolvedValue({
      id: 2,
      term: "rust",
      kind: "language",
      weight: 2,
    });

    const { result } = renderHook(() => useInterests(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.interests).toHaveLength(1));
    result.current.create({ term: "rust", kind: "language", weight: 2 });

    await waitFor(() => expect(apiClient.createInterest).toHaveBeenCalled());
  });

  it("remove calls API", async () => {
    vi.mocked(apiClient.deleteInterest).mockResolvedValue(undefined);

    const { result } = renderHook(() => useInterests(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.interests).toHaveLength(1));
    result.current.remove(1);

    await waitFor(() => expect(apiClient.deleteInterest).toHaveBeenCalledWith(1));
  });

  it("addExclude and removeExclude call API", async () => {
    vi.mocked(apiClient.addExclusion).mockResolvedValue({ id: 2, term: "boilerplate" });
    vi.mocked(apiClient.removeExclusion).mockResolvedValue(undefined);

    const { result } = renderHook(() => useInterests(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.exclusions).toHaveLength(1));
    result.current.addExclude("boilerplate");
    await waitFor(() => expect(apiClient.addExclusion).toHaveBeenCalledWith("boilerplate"));

    result.current.removeExclude(1);
    await waitFor(() => expect(apiClient.removeExclusion).toHaveBeenCalledWith(1));
  });
});
