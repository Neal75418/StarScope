import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { RepoSelector } from "../RepoSelector";
import type { RepoWithSignals } from "../../../api/types";

const mockT = {
  compare: {
    selectRepos: "Select repositories to compare",
    searchPlaceholder: "Search watchlist...",
    minRepos: "Select at least 2 repos",
    maxRepos: "Maximum 5 repos",
    needMoreRepos:
      "Comparing needs at least 2 tracked repositories (you have {count}). Head to Discover to start tracking.",
    noMatch: "No repositories match your search.",
  },
  common: { goDiscover: "Go to Discover" },
};

function makeRepo(overrides: Partial<RepoWithSignals> = {}): RepoWithSignals {
  return {
    id: 1,
    owner: "facebook",
    name: "react",
    full_name: "facebook/react",
    url: "https://github.com/facebook/react",
    description: null,
    language: null,
    added_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    stars: 1000,
    forks: 100,
    stars_delta_7d: null,
    stars_delta_30d: null,
    velocity: null,
    acceleration: null,
    trend: null,
    forks_delta_7d: null,
    forks_delta_30d: null,
    issues_delta_7d: null,
    issues_delta_30d: null,
    last_fetched: null,
    ...overrides,
  };
}

describe("RepoSelector", () => {
  const repos = [
    makeRepo({ id: 1, full_name: "facebook/react" }),
    makeRepo({ id: 2, full_name: "vuejs/vue" }),
    makeRepo({ id: 3, full_name: "angular/angular" }),
  ];

  it("renders heading and search input", () => {
    render(
      <RepoSelector
        repos={repos}
        selectedIds={[]}
        onToggle={vi.fn()}
        onGoDiscover={vi.fn()}
        t={mockT as never}
      />
    );
    expect(screen.getByText("Select repositories to compare")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search watchlist...")).toBeInTheDocument();
  });

  it("renders all repo chips", () => {
    render(
      <RepoSelector
        repos={repos}
        selectedIds={[]}
        onToggle={vi.fn()}
        onGoDiscover={vi.fn()}
        t={mockT as never}
      />
    );
    expect(screen.getByText("facebook/react")).toBeInTheDocument();
    expect(screen.getByText("vuejs/vue")).toBeInTheDocument();
    expect(screen.getByText("angular/angular")).toBeInTheDocument();
  });

  it("calls onToggle when chip is clicked", async () => {
    const onToggle = vi.fn();
    render(
      <RepoSelector
        repos={repos}
        selectedIds={[]}
        onToggle={onToggle}
        onGoDiscover={vi.fn()}
        t={mockT as never}
      />
    );
    await userEvent.click(screen.getByText("vuejs/vue"));
    expect(onToggle).toHaveBeenCalledWith(2);
  });

  it("shows × on selected chips", () => {
    render(
      <RepoSelector
        repos={repos}
        selectedIds={[1]}
        onToggle={vi.fn()}
        onGoDiscover={vi.fn()}
        t={mockT as never}
      />
    );
    // The selected chip has a × span
    const chip = screen.getByText("facebook/react");
    expect(chip.closest("button")?.querySelector(".compare-chip-x")).toBeInTheDocument();
  });

  it("disables chips when max repos reached", () => {
    render(
      <RepoSelector
        repos={[
          ...repos,
          makeRepo({ id: 4, full_name: "sveltejs/svelte" }),
          makeRepo({ id: 5, full_name: "solidjs/solid" }),
          makeRepo({ id: 6, full_name: "preactjs/preact" }),
        ]}
        selectedIds={[1, 2, 3, 4, 5]}
        onToggle={vi.fn()}
        onGoDiscover={vi.fn()}
        t={mockT as never}
      />
    );
    // The 6th chip (not selected) should be disabled
    const preactChip = screen.getByText("preactjs/preact");
    expect(preactChip.closest("button")).toBeDisabled();
  });

  it("filters repos by search query", async () => {
    render(
      <RepoSelector
        repos={repos}
        selectedIds={[]}
        onToggle={vi.fn()}
        onGoDiscover={vi.fn()}
        t={mockT as never}
      />
    );
    const input = screen.getByPlaceholderText("Search watchlist...");
    await userEvent.type(input, "vue");
    expect(screen.getByText("vuejs/vue")).toBeInTheDocument();
    expect(screen.queryByText("facebook/react")).not.toBeInTheDocument();
  });

  it("shows min-repos hint when less than 2 selected", () => {
    render(
      <RepoSelector
        repos={repos}
        selectedIds={[1]}
        onToggle={vi.fn()}
        onGoDiscover={vi.fn()}
        t={mockT as never}
      />
    );
    expect(screen.getByText("Select at least 2 repos")).toBeInTheDocument();
  });

  it("hides min-repos hint when 2+ selected", () => {
    render(
      <RepoSelector
        repos={repos}
        selectedIds={[1, 2]}
        onToggle={vi.fn()}
        onGoDiscover={vi.fn()}
        t={mockT as never}
      />
    );
    expect(screen.queryByText("Select at least 2 repos")).not.toBeInTheDocument();
  });

  it("replaces the selector with an explanation and Discover CTA when fewer than 2 repos are tracked", async () => {
    const onGoDiscover = vi.fn();
    render(
      <RepoSelector
        repos={[makeRepo({ id: 1 })]}
        selectedIds={[]}
        onToggle={vi.fn()}
        onGoDiscover={onGoDiscover}
        t={mockT as never}
      />
    );
    // 不可能完成的指令與搜空集合的輸入框都不該出現
    expect(screen.queryByPlaceholderText("Search watchlist...")).not.toBeInTheDocument();
    expect(screen.queryByText("Select at least 2 repos")).not.toBeInTheDocument();
    expect(screen.getByText(/you have 1/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("compare-go-discover"));
    expect(onGoDiscover).toHaveBeenCalled();
  });

  it("shows a no-match message when the search excludes everything", async () => {
    render(
      <RepoSelector
        repos={repos}
        selectedIds={[]}
        onToggle={vi.fn()}
        onGoDiscover={vi.fn()}
        t={mockT as never}
      />
    );
    await userEvent.type(screen.getByPlaceholderText("Search watchlist..."), "zzz");
    expect(screen.getByText("No repositories match your search.")).toBeInTheDocument();
  });
});
