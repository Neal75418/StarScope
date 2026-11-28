/**
 * DiscoveryResults：搜尋結果裡哪些已經在追蹤清單。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiscoveryResults } from "../DiscoveryResults";
import type { DiscoveryRepo } from "../../../api/client";

const REPO: DiscoveryRepo = {
  id: 77,
  full_name: "a/new",
  owner: "a",
  name: "new",
  description: null,
  language: null,
  stars: 1,
  forks: 0,
  url: "https://github.com/a/new",
  topics: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  owner_avatar_url: null,
  open_issues_count: 0,
  license_spdx: null,
  license_name: null,
  archived: false,
};

function renderResults(props: {
  watchlistFullNames: Set<string>;
  watchlistGithubIds?: Set<number>;
}) {
  render(
    <DiscoveryResults
      repos={[REPO]}
      totalCount={1}
      hasMore={false}
      loading={false}
      error={null}
      onAddToWatchlist={vi.fn()}
      onLoadMore={vi.fn()}
      addingRepoIds={new Set()}
      hasSearched
      {...props}
    />
  );
}

describe("DiscoveryResults", () => {
  it("knows a result is tracked by its GitHub id when the local row still has the old name", () => {
    // 本機那一列還叫 a/old（還沒抓到改名），搜尋結果是 GitHub 上現在的名稱 a/new
    renderResults({ watchlistFullNames: new Set(["a/old"]), watchlistGithubIds: new Set([77]) });

    expect(screen.getByRole("button", { name: "In Watchlist" })).toBeDisabled();
  });

  it("offers to add a result that is not tracked", () => {
    renderResults({ watchlistFullNames: new Set(["a/old"]), watchlistGithubIds: new Set([5]) });

    expect(screen.getByRole("button", { name: "+ Watchlist" })).toBeEnabled();
  });
});
