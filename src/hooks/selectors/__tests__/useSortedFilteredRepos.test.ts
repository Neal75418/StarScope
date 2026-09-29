/**
 * 分類篩選直接用每個 repo 自己的 category_ids：不另查分類成員，所以沒有上限（以前的成員端點預設只回
 * 100 筆，大分類被截斷），選下去的那一刻就是完整的篩選結果（以前等成員回來之前會先列出全部）。
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { RepoWithSignals } from "../../../api/client";
import type { WatchlistState } from "../../../contexts/WatchlistContext";
import { initialState } from "../../../contexts/watchlistReducer";
import { useSortedFilteredRepos } from "../useWatchlistSelectors";

const state = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../../../contexts/WatchlistContext", () => ({
  useWatchlistState: () => state.current,
}));

function repo(id: number, category_ids: number[]): RepoWithSignals {
  return {
    id,
    owner: "o",
    name: `r${id}`,
    full_name: `o/r${id}`,
    url: `https://github.com/o/r${id}`,
    description: null,
    language: null,
    added_at: "2026-08-15T00:00:00Z",
    updated_at: "2026-08-22T00:00:00Z",
    stars: id,
    forks: 0,
    stars_delta_1d: null,
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
    category_ids,
  };
}

function shown(repos: RepoWithSignals[], selectedCategoryId: number | null) {
  state.current = {
    ...initialState,
    repos,
    filters: { ...initialState.filters, selectedCategoryId },
  } as WatchlistState;
  const { result } = renderHook(() => useSortedFilteredRepos("stars", "desc"));
  return result.current.map((r) => r.id);
}

describe("useSortedFilteredRepos category filter", () => {
  it("lists every member of a large category the moment it is picked", () => {
    const members = Array.from({ length: 150 }, (_, i) => repo(i + 1, [5]));
    const other = repo(999, [7]);

    const ids = shown([...members, other], 5);

    expect(ids).toHaveLength(150);
    expect(ids).not.toContain(999);
  });

  it("uses every category a repo belongs to", () => {
    const repos = [repo(1, [5, 7]), repo(2, [7]), repo(3, [])];

    expect(shown(repos, 7).sort()).toEqual([1, 2]);
    expect(shown(repos, 5)).toEqual([1]);
  });

  it("lists all repos when no category is picked", () => {
    const repos = [repo(1, [5]), repo(2, [])];

    expect(shown(repos, null).sort()).toEqual([1, 2]);
  });
});
