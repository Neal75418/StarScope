/**
 * RepoList 的列元素：react-window 給的 ariaAttributes 要放到列上。
 * 動態列高靠 aria-posinset 把元素對到位置（量到的高度寫進快取的哪一格），也給 role="listitem"
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { RepoWithSignals } from "../../../api/client";
import { RepoList } from "../RepoList";

vi.mock("react-virtualized-auto-sizer", () => ({
  AutoSizer: ({ renderProp }: { renderProp: (s: { height: number; width: number }) => unknown }) =>
    renderProp({ height: 600, width: 800 }),
}));

vi.mock("../../../components/RepoCard", () => ({
  RepoCard: () => <div />,
}));

function makeRepo(id: number): RepoWithSignals {
  return {
    id,
    owner: "o",
    name: `r${id}`,
    full_name: `o/r${id}`,
    url: "https://github.com/o/r",
    description: null,
    github_id: id,
    language: null,
    stars: 0,
    forks: 0,
    added_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  } as RepoWithSignals;
}

describe("RepoList 的列元素", () => {
  it("puts react-window's aria attributes on each row", () => {
    const { container } = render(
      <RepoList
        repos={[makeRepo(1), makeRepo(2)]}
        loadingRepoId={null}
        onFetch={vi.fn()}
        onRemove={vi.fn()}
        batchData={{}}
        batchOwnsData
        onVisibleRangeChange={vi.fn()}
      />
    );

    const rows = [...container.querySelectorAll(".virtual-repo-item")];
    expect(rows.map((r) => r.getAttribute("aria-posinset"))).toEqual(["1", "2"]);
    expect(rows.every((r) => r.getAttribute("role") === "listitem")).toBe(true);
  });
});
