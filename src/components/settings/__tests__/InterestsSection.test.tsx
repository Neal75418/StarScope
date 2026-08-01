/**
 * InterestsSection 測試：列表渲染、新增、移除。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { InterestsSection } from "../InterestsSection";
import { createTestQueryClient } from "../../../lib/react-query";
import * as apiClient from "../../../api/client";

vi.mock("../../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/client")>();
  return {
    ...actual,
    getInterests: vi.fn(),
    getExclusions: vi.fn(),
    createInterest: vi.fn(),
    deleteInterest: vi.fn(),
  };
});

function renderSection(onToast = vi.fn()) {
  const client = createTestQueryClient();
  return {
    onToast,
    ...render(
      <QueryClientProvider client={client}>
        <InterestsSection onToast={onToast} />
      </QueryClientProvider>
    ),
  };
}

describe("InterestsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.getInterests).mockResolvedValue({
      interests: [{ id: 1, term: "tauri", kind: "topic", weight: 3 }],
    });
    vi.mocked(apiClient.getExclusions).mockResolvedValue({
      exclusions: [{ id: 1, term: "awesome" }],
    });
  });

  it("renders interests and exclusions", async () => {
    renderSection();
    expect(await screen.findByText("tauri")).toBeInTheDocument();
    expect(await screen.findByText("awesome")).toBeInTheDocument();
  });

  it("adds an interest via form and shows a success toast", async () => {
    vi.mocked(apiClient.createInterest).mockResolvedValue({
      id: 2,
      term: "rust",
      kind: "language",
      weight: 2,
    });
    const { onToast } = renderSection();
    await screen.findByText("tauri");
    fireEvent.change(screen.getByTestId("interest-term-input"), { target: { value: "rust" } });
    fireEvent.click(screen.getByTestId("interest-add-btn"));
    await waitFor(() => expect(apiClient.createInterest).toHaveBeenCalled());
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("Interest added", "success"));
    expect(onToast).not.toHaveBeenCalledWith(expect.any(String), "error");
  });

  it("shows an error toast (not success) when create fails", async () => {
    vi.mocked(apiClient.createInterest).mockRejectedValue(new Error("duplicate"));
    const { onToast } = renderSection();
    await screen.findByText("tauri");
    fireEvent.change(screen.getByTestId("interest-term-input"), { target: { value: "rust" } });
    fireEvent.click(screen.getByTestId("interest-add-btn"));
    await waitFor(() => expect(apiClient.createInterest).toHaveBeenCalled());
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("Operation failed", "error"));
    expect(onToast).not.toHaveBeenCalledWith(expect.any(String), "success");
  });

  it("removes an interest and shows a success toast", async () => {
    vi.mocked(apiClient.deleteInterest).mockResolvedValue(undefined);
    const { onToast } = renderSection();
    await screen.findByText("tauri");
    fireEvent.click(screen.getByTestId("interest-remove-1"));
    await waitFor(() => expect(apiClient.deleteInterest).toHaveBeenCalledWith(1));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("Interest removed", "success"));
    expect(onToast).not.toHaveBeenCalledWith(expect.any(String), "error");
  });

  it("shows an error toast (not success) when remove fails", async () => {
    vi.mocked(apiClient.deleteInterest).mockRejectedValue(new Error("network error"));
    const { onToast } = renderSection();
    await screen.findByText("tauri");
    fireEvent.click(screen.getByTestId("interest-remove-1"));
    await waitFor(() => expect(apiClient.deleteInterest).toHaveBeenCalledWith(1));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("Operation failed", "error"));
    expect(onToast).not.toHaveBeenCalledWith(expect.any(String), "success");
  });
});
