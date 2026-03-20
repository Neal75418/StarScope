/**
 * Unit tests for SimilarRepos component
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { SimilarRepos } from "../SimilarRepos";
import * as apiClient from "../../api/client";
import { createTestQueryClient } from "../../lib/react-query";

// Mock tauri opener
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

// Mock API client
vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getSimilarRepos: vi.fn(),
  };
});

function renderWithClient(ui: React.ReactElement) {
  const client = createTestQueryClient();
  return render(React.createElement(QueryClientProvider, { client }, ui));
}

describe("SimilarRepos", () => {
  const mockSimilarRepos = {
    repo_id: 1,
    total: 2,
    similar: [
      {
        repo_id: 2,
        full_name: "vuejs/vue",
        description: "A progressive JavaScript framework",
        url: "https://github.com/vuejs/vue",
        similarity_score: 0.85,
        language: "JavaScript",
        same_language: true,
        shared_topics: ["javascript", "frontend", "framework"],
      },
      {
        repo_id: 3,
        full_name: "angular/angular",
        description: "One framework. Mobile & desktop.",
        url: "https://github.com/angular/angular",
        similarity_score: 0.72,
        language: "TypeScript",
        same_language: false,
        shared_topics: ["typescript", "frontend"],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    vi.mocked(apiClient.getSimilarRepos).mockImplementation(() => new Promise(() => {}));

    renderWithClient(<SimilarRepos repoId={1} />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("displays similar repos after loading", async () => {
    vi.mocked(apiClient.getSimilarRepos).mockResolvedValue(mockSimilarRepos);

    renderWithClient(<SimilarRepos repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText("vuejs/vue")).toBeInTheDocument();
      expect(screen.getByText("angular/angular")).toBeInTheDocument();
    });
  });

  it("shows error message on failure", async () => {
    vi.mocked(apiClient.getSimilarRepos).mockRejectedValue(new Error("Network error"));

    renderWithClient(<SimilarRepos repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText("Failed to load recommendations")).toBeInTheDocument();
    });
  });

  it("shows empty state when no similar repos", async () => {
    vi.mocked(apiClient.getSimilarRepos).mockResolvedValue({ repo_id: 1, total: 0, similar: [] });

    renderWithClient(<SimilarRepos repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText("No similar repos found in your watchlist.")).toBeInTheDocument();
    });
  });

  it("displays similarity score as percentage", async () => {
    vi.mocked(apiClient.getSimilarRepos).mockResolvedValue(mockSimilarRepos);

    renderWithClient(<SimilarRepos repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText("85%")).toBeInTheDocument();
      expect(screen.getByText("72%")).toBeInTheDocument();
    });
  });

  it("shows same language badge", async () => {
    vi.mocked(apiClient.getSimilarRepos).mockResolvedValue(mockSimilarRepos);

    renderWithClient(<SimilarRepos repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText("Same Language")).toBeInTheDocument();
    });
  });

  it("displays shared topics", async () => {
    vi.mocked(apiClient.getSimilarRepos).mockResolvedValue(mockSimilarRepos);

    renderWithClient(<SimilarRepos repoId={1} />);

    await waitFor(() => {
      expect(screen.getAllByText("javascript").length).toBeGreaterThan(0);
      expect(screen.getAllByText("frontend").length).toBeGreaterThan(0);
    });
  });

  it("shows close button when onClose provided", async () => {
    const mockOnClose = vi.fn();
    vi.mocked(apiClient.getSimilarRepos).mockResolvedValue(mockSimilarRepos);

    renderWithClient(<SimilarRepos repoId={1} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText("×")).toBeInTheDocument();
    });
  });

  it("calls onClose when close button clicked", async () => {
    const user = userEvent.setup();
    const mockOnClose = vi.fn();
    vi.mocked(apiClient.getSimilarRepos).mockResolvedValue(mockSimilarRepos);

    renderWithClient(<SimilarRepos repoId={1} onClose={mockOnClose} />);

    await waitFor(() => screen.getByText("×"));
    await user.click(screen.getByText("×"));

    expect(mockOnClose).toHaveBeenCalled();
  });

  it("opens links in new tab", async () => {
    const user = userEvent.setup();
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    vi.mocked(apiClient.getSimilarRepos).mockResolvedValue(mockSimilarRepos);

    renderWithClient(<SimilarRepos repoId={1} />);

    await waitFor(async () => {
      const link = screen.getByRole("link", { name: "vuejs/vue" });
      expect(link).not.toHaveAttribute("target");

      await user.click(link);
      expect(openUrl).toHaveBeenCalledWith("https://github.com/vuejs/vue");
    });
  });
});
