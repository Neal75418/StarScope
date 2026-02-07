import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { LanguagesBadge } from "../LanguagesBadge";
import * as apiClient from "../../api/client";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getLanguagesSummary: vi.fn(),
    fetchLanguages: vi.fn(),
  };
});

describe("LanguagesBadge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    vi.mocked(apiClient.getLanguagesSummary).mockImplementation(() => new Promise(() => {}));

    render(<LanguagesBadge repoId={1} />);
    expect(screen.getByText("...")).toBeInTheDocument();
    expect(screen.getByText("...")).toHaveClass("language-badge-loading");
  });

  it("shows error badge when load fails", async () => {
    vi.mocked(apiClient.getLanguagesSummary).mockRejectedValue(
      new apiClient.ApiError(500, "Server error")
    );

    render(<LanguagesBadge repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText("!")).toBeInTheDocument();
    });
    expect(screen.getByText("!")).toHaveClass("language-badge-error");
  });

  it("shows empty badge with fetch button when no data", async () => {
    vi.mocked(apiClient.getLanguagesSummary).mockRejectedValue(
      new apiClient.ApiError(404, "Not found")
    );

    render(<LanguagesBadge repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText("?")).toBeInTheDocument();
    });
    expect(screen.getByText("?")).toHaveClass("language-badge-empty");
  });

  it("fetches data when empty badge clicked", async () => {
    vi.mocked(apiClient.getLanguagesSummary).mockRejectedValue(
      new apiClient.ApiError(404, "Not found")
    );
    vi.mocked(apiClient.fetchLanguages).mockResolvedValue({
      repo_id: 1,
      repo_name: "test/repo",
      languages: [],
      primary_language: null,
      total_bytes: 0,
      last_updated: null,
    });

    render(<LanguagesBadge repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText("?")).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button"));

    expect(apiClient.fetchLanguages).toHaveBeenCalledWith(1);
  });

  it("shows TypeScript badge with correct colors", async () => {
    vi.mocked(apiClient.getLanguagesSummary).mockResolvedValue({
      repo_id: 1,
      primary_language: "TypeScript",
      language_count: 3,
      last_updated: "2024-01-01T00:00:00Z",
    });

    render(<LanguagesBadge repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText("TypeScript")).toBeInTheDocument();
    });

    const badge = screen.getByText("TypeScript");
    expect(badge).toHaveStyle({ backgroundColor: "#3178c6", color: "#ffffff" });
    expect(badge).toHaveAttribute("title", "TypeScript (+2 more)");
  });

  it("shows Python badge with correct colors", async () => {
    vi.mocked(apiClient.getLanguagesSummary).mockResolvedValue({
      repo_id: 1,
      primary_language: "Python",
      language_count: 1,
      last_updated: "2024-01-01T00:00:00Z",
    });

    render(<LanguagesBadge repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText("Python")).toBeInTheDocument();
    });

    const badge = screen.getByText("Python");
    expect(badge).toHaveStyle({ backgroundColor: "#3572A5", color: "#ffffff" });
    expect(badge).toHaveAttribute("title", "Python");
  });

  it("shows unknown language with default colors", async () => {
    vi.mocked(apiClient.getLanguagesSummary).mockResolvedValue({
      repo_id: 1,
      primary_language: "Brainfuck",
      language_count: 1,
      last_updated: "2024-01-01T00:00:00Z",
    });

    render(<LanguagesBadge repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText("Brainfuck")).toBeInTheDocument();
    });

    const badge = screen.getByText("Brainfuck");
    expect(badge).toHaveStyle({ backgroundColor: "#6b7280", color: "#f3f4f6" });
  });

  it("shows empty badge when primary_language is null", async () => {
    vi.mocked(apiClient.getLanguagesSummary).mockResolvedValue({
      repo_id: 1,
      primary_language: null,
      language_count: 0,
      last_updated: null,
    });

    render(<LanguagesBadge repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText("?")).toBeInTheDocument();
    });
  });
});
