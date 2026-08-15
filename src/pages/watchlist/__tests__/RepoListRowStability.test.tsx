/**
 * 守住 react-window 的 remount 陷阱。
 *
 * react-window v2 內部是 useMemo(() => memo(rowComponent), [rowComponent])，
 * rowComponent 換引用就是新的元件型別 → 整組可見 row 卸載重掛。
 * 這條測試不經過 src/test/setup.ts 的 react-window mock（那個 mock 會把
 * 所有 row 直接渲染成 div，虛擬滾動的行為完全測不到），改用自己的 mock
 * 直接捕捉 List 收到的 rowComponent 引用。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { RepoWithSignals } from "../../../api/client";

const receivedRowComponents: unknown[] = [];

vi.mock("react-window", () => ({
  List: (props: { rowComponent: unknown }) => {
    receivedRowComponents.push(props.rowComponent);
    return <div data-testid="list" />;
  },
}));

vi.mock("react-virtualized-auto-sizer", () => ({
  AutoSizer: ({ renderProp }: { renderProp: (s: { height: number; width: number }) => unknown }) =>
    renderProp({ height: 600, width: 800 }),
}));

vi.mock("../../../components/RepoCard", () => ({
  RepoCard: () => <div />,
}));

import { RepoList } from "../RepoList";

function makeRepo(id: number): RepoWithSignals {
  return {
    id,
    owner: "o",
    name: `r${id}`,
    full_name: `o/r${id}`,
    url: "https://github.com/o/r",
    description: null,
    language: null,
    stars: 0,
    forks: 0,
    added_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  } as RepoWithSignals;
}

describe("RepoList rowComponent 穩定性", () => {
  beforeEach(() => {
    receivedRowComponents.length = 0;
  });

  it("批次資料到貨時不更換 rowComponent 引用", () => {
    const props = {
      repos: [makeRepo(1), makeRepo(2)],
      loadingRepoId: null,
      onFetch: vi.fn(),
      onRemove: vi.fn(),
      batchData: {},
      batchOwnsData: true,
      onVisibleRangeChange: vi.fn(),
    };
    const { rerender } = render(<RepoList {...props} />);

    // 模擬批次到貨：batchData 換成新物件（實際情境每 150ms 一次）
    rerender(<RepoList {...props} batchData={{ 1: { badges: [], signals: [] } }} />);
    // 模擬勾選：selectedIds 換新 Set
    rerender(
      <RepoList
        {...props}
        batchData={{ 1: { badges: [], signals: [] } }}
        isSelectionMode
        selectedIds={new Set([1])}
        onToggleSelection={vi.fn()}
      />
    );

    expect(receivedRowComponents.length).toBeGreaterThanOrEqual(3);
    const unique = new Set(receivedRowComponents);
    expect(unique.size, "rowComponent 換了引用 → react-window 會把整組 row 卸載重掛而非重繪").toBe(
      1
    );
  });
});
