/**
 * RecommendedForYou 卡片元件測試。
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../utils/url", () => ({
  safeOpenUrl: vi.fn(),
}));

vi.mock("../../../i18n", async () => {
  const { translations } = await vi.importActual<typeof import("../../../i18n/translations")>(
    "../../../i18n/translations"
  );
  return {
    useI18n: () => ({ t: translations.en, language: "en" }),
    interpolate: (s: string) => s,
  };
});

vi.mock("../../../hooks/usePersonalizedRecs", () => ({
  usePersonalizedRecs: () => ({
    data: {
      recommendations: [
        {
          repo_id: 1,
          full_name: "facebook/react",
          description: "A JavaScript library",
          language: "JavaScript",
          url: "https://github.com/facebook/react",
          stars: 200000,
          velocity: 50,
          trend: 1,
          similarity_score: 0.85,
          shared_topics: ["ui"],
          same_language: true,
          source_repo_id: 2,
          source_repo_name: "vuejs/vue",
        },
      ],
    },
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../../../hooks/useDismissedRecs", () => ({
  useDismissedRecs: () => ({
    dismissedIds: new Set<number>(),
    dismiss: vi.fn(),
  }),
}));

// Mock CSS modules
vi.mock("../Discovery.module.css", () => ({
  default: new Proxy({}, { get: (_, name) => String(name) }),
}));

import { RecommendedForYou } from "../RecommendedForYou";
import { safeOpenUrl } from "../../../utils/url";

describe("RecommendedForYou", () => {
  it("renders repo name as an anchor with correct href", () => {
    render(<RecommendedForYou watchlistFullNames={new Set()} onAddToWatchlist={vi.fn()} />);

    const link = screen.getByText("facebook/react");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "https://github.com/facebook/react");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("clicking repo name calls safeOpenUrl", async () => {
    render(<RecommendedForYou watchlistFullNames={new Set()} onAddToWatchlist={vi.fn()} />);

    await userEvent.click(screen.getByText("facebook/react"));
    expect(safeOpenUrl).toHaveBeenCalledWith("https://github.com/facebook/react");
  });

  it("shows add-to-watchlist button when handler provided", () => {
    render(<RecommendedForYou watchlistFullNames={new Set()} onAddToWatchlist={vi.fn()} />);

    expect(screen.getByText("+ Watchlist")).toBeInTheDocument();
  });
});
