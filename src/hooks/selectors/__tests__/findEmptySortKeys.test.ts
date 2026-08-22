/**
 * 空排序鍵的判斷。
 *
 * 起因：8/22 的追蹤清單裡 acceleration 是 94/94 全 null（它要 14 天前的快照，
 * 而資料庫從 8/15 才開始）。點下「加速度」，按鈕亮起 ↓ 但前八名一個都沒動——
 * 按鈕看起來生效了，其實沒有。
 */

import { describe, it, expect } from "vitest";
import { findEmptySortKeys } from "../useWatchlistSelectors";
import type { RepoWithSignals } from "../../../api/client";

function makeRepo(overrides: Partial<RepoWithSignals> = {}): RepoWithSignals {
  return {
    id: 1,
    owner: "a",
    name: "b",
    full_name: "a/b",
    url: "https://github.com/a/b",
    description: null,
    language: null,
    added_at: "2026-08-15T00:00:00Z",
    updated_at: "2026-08-22T00:00:00Z",
    stars: 1000,
    forks: 10,
    stars_delta_1d: 1,
    stars_delta_7d: 50,
    stars_delta_30d: null,
    velocity: 7.1,
    acceleration: null,
    trend: 1,
    forks_delta_7d: null,
    forks_delta_30d: null,
    issues_delta_7d: null,
    issues_delta_30d: null,
    last_fetched: "2026-08-22T00:00:00Z",
    ...overrides,
  };
}

describe("findEmptySortKeys", () => {
  it("整份清單都沒有值的鍵才算空", () => {
    const repos = [makeRepo({ id: 1 }), makeRepo({ id: 2 })];

    expect(findEmptySortKeys(repos)).toEqual(["acceleration"]);
  });

  it("只要有一筆有值就不算空——停用一個排得動的鍵比不停用更糟", () => {
    const repos = [makeRepo({ id: 1 }), makeRepo({ id: 2, acceleration: 3.2 })];

    expect(findEmptySortKeys(repos)).toEqual([]);
  });

  it("認得衍生的相對變化鍵，不是只看 repo 上的欄位", () => {
    // stars_delta_7d 全 null → relative_7d 也算不出來
    const repos = [makeRepo({ stars_delta_7d: null, velocity: null })];

    expect(findEmptySortKeys(repos)).toContain("relative_7d");
    expect(findEmptySortKeys(repos)).toContain("stars_delta_7d");
  });

  it("期初為零讓相對變化算不出來時也算空", () => {
    // 從 0 漲到 5：期初是 0，相對變化無意義
    const repos = [makeRepo({ stars: 5, stars_delta_7d: 5 })];

    expect(findEmptySortKeys(repos)).toContain("relative_7d");
    expect(findEmptySortKeys(repos)).not.toContain("stars_delta_7d");
  });

  it("清單是空的時候不停用任何鍵——那是「還沒載入」，不是「這個鍵沒用」", () => {
    expect(findEmptySortKeys([])).toEqual([]);
  });
});
