/**
 * 守住 react-window 的兩個陷阱：remount 與 row key。
 *
 * react-window v2 內部是 useMemo(() => memo(rowComponent), [rowComponent])，
 * rowComponent 換引用就是新的元件型別 → 整組可見 row 卸載重掛。
 * 沒給 rowKey 時預設拿 index 當 key：位置變了（排序、篩選、新增、刪除），列裡的 state 會換給別的 repo。
 * 這條測試不經過 src/test/setup.ts 的 react-window mock（那個 mock 會把
 * 所有 row 直接渲染成 div，虛擬滾動的行為完全測不到），改用自己的 mock
 * 直接捕捉 List 收到的 rowComponent 與 rowKey。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { RepoWithSignals } from "../../../api/client";

const receivedRowComponents: unknown[] = [];
const receivedListProps: {
  rowKey?: (index: number, data: unknown) => unknown;
  rowProps: unknown;
}[] = [];

vi.mock("react-window", () => ({
  List: (props: {
    rowComponent: unknown;
    rowKey?: (index: number, data: unknown) => unknown;
    rowProps: unknown;
  }) => {
    receivedRowComponents.push(props.rowComponent);
    receivedListProps.push(props);
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

describe("RepoList 的 rowComponent 穩定性與 row key", () => {
  beforeEach(() => {
    receivedRowComponents.length = 0;
    receivedListProps.length = 0;
  });

  it("keys each row by its repo, not its position", () => {
    // react-window 預設拿 index 當 key：排序、篩選、刪掉上面一筆之後，展開中的卡片元件
    // （圖表的時間範圍等 state）會直接換給別的 repo 繼續用
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
    const first = receivedListProps[receivedListProps.length - 1];
    expect(first.rowKey?.(0, first.rowProps)).toBe(1);
    expect(first.rowKey?.(1, first.rowProps)).toBe(2);

    rerender(<RepoList {...props} repos={[makeRepo(2), makeRepo(1)]} />);

    const reordered = receivedListProps[receivedListProps.length - 1];
    expect(reordered.rowKey?.(0, reordered.rowProps)).toBe(2);
    // react-window 要求 rowKey 的引用穩定（render 時呼叫，不會自動 memo）
    expect(reordered.rowKey).toBe(first.rowKey);
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
