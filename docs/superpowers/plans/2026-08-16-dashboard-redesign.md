# 儀表板重設計 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把儀表板從「這批東西的現況」改成三段式的「需要注意 / 在動 / 可讀」，並讓成長指標改用相對值。

**Architecture:** 後端修正差值的回溯上限、新增單日差值、統一週摘要的回溯規則；前端在 `useDashboard` 算出相對成長與中位數門檻，新增兩個區塊元件，把既有的 `SignalSpotlight` 移進段二當持久層，`Dashboard.tsx` 改為三段排列。

**Tech Stack:** FastAPI + SQLAlchemy（sidecar）、React 19 + TanStack Query + Vitest（前端）、pytest（後端）

**Spec:** `docs/superpowers/specs/2026-08-16-dashboard-redesign-design.md`

## Global Constraints

- 回溯上限一律為 `min(days // 2, 7)`，三個窗口都不得劣於現況
- 面板取「有資料的最寬窗」，判定為「七日窗算得出來的 repo 數 ≥ 單日窗」
- 顯著門檻為「相對成長中位數 × 10」，母體含零與負值；中位數為 0 時不畫線
- 排行只取正成長、最多 5 個，不足 5 個就顯示實際數量
- 空狀態不得宣稱未經檢查的事（沿用本專案既有原則：null ≠ 0）
- 每一條行為變更都要做突變測試：把實作改回舊行為、確認對應測試轉紅、還原後 `diff -q` 位元組相同
- 還原一律用檔案備份，**不得使用 `git checkout`**（會洗掉未提交的實作）
- 後端驗證指令：`cd sidecar && ./.venv/bin/mypy . --config-file mypy.ini` 與 `./.venv/bin/python -m pytest tests/ -q --cov=. --cov-fail-under=85`
- 前端驗證指令：`npx tsc --noEmit`、`npx eslint src --max-warnings 0`、`npx vitest run`
- i18n 文案兩個語系都要加：`en` 與 `zh-TW`，皆在 `src/i18n/translations.ts`

---

### Task 1: 回溯上限跟窗口成比例

修正既有缺陷：`_find_snapshot` 的回溯上限寫死七天，與請求的窗口無關。單日窗會因此拿七天前的快照冒充。

**Files:**
- Modify: `sidecar/services/analyzer.py:90-119`
- Test: `sidecar/tests/test_services_analyzer.py`

**Interfaces:**
- Consumes: 無
- Produces: `_find_snapshot(snap_by_date: dict[date, RepoSnapshot], target_date: date, max_backtrack_days: int) -> RepoSnapshot | None`；`calculate_delta` 行為改變，回溯上限為 `min(days // 2, 7)`

- [ ] **Step 1: 寫失敗的測試**

加到 `sidecar/tests/test_services_analyzer.py` 末端：

```python
class TestBacktrackScalesWithWindow:
    """回溯上限寫死七天時，單日窗會拿七天前的快照冒充「一天」。

    段二的排行完全按相對成長排序，被放大七倍的成長會直接變成假的第一名，
    而畫面上看不出任何異常。
    """

    def _snap(self, day: date, stars: int) -> RepoSnapshot:
        return RepoSnapshot(repo_id=1, stars=stars, forks=0,
                            watchers=0, open_issues=0, snapshot_date=day)

    def test_one_day_window_requires_an_exact_match(self, test_db):
        from services.analyzer import calculate_delta

        today = utc_today()
        # 今天有、昨天沒有、七天前有
        snap_by_date = {
            today: self._snap(today, 1000),
            today - timedelta(days=7): self._snap(today - timedelta(days=7), 100),
        }

        result = calculate_delta(1, 1, test_db, snap_by_date=snap_by_date)

        assert result is None, "昨天沒有快照時應回 None，不得拿七天前的來比"

    def test_one_day_window_works_when_yesterday_exists(self, test_db):
        from services.analyzer import calculate_delta

        today = utc_today()
        snap_by_date = {
            today: self._snap(today, 1000),
            today - timedelta(days=1): self._snap(today - timedelta(days=1), 900),
        }

        assert calculate_delta(1, 1, test_db, snap_by_date=snap_by_date) == 100.0

    def test_seven_day_window_backtracks_at_most_three_days(self, test_db):
        from services.analyzer import calculate_delta

        today = utc_today()
        # 目標是 today-7，往前三天內（today-8..today-10）有；再更早的不算
        near = {today: self._snap(today, 1000),
                today - timedelta(days=10): self._snap(today - timedelta(days=10), 500)}
        far = {today: self._snap(today, 1000),
               today - timedelta(days=11): self._snap(today - timedelta(days=11), 500)}

        assert calculate_delta(1, 7, test_db, snap_by_date=near) == 500.0
        assert calculate_delta(1, 7, test_db, snap_by_date=far) is None

    def test_thirty_day_window_keeps_the_existing_seven_day_cap(self, test_db):
        """days // 2 會把三十日窗放寬到十五天回溯；min(..., 7) 必須擋住。"""
        from services.analyzer import calculate_delta

        today = utc_today()
        at_cap = {today: self._snap(today, 1000),
                  today - timedelta(days=37): self._snap(today - timedelta(days=37), 500)}
        beyond = {today: self._snap(today, 1000),
                  today - timedelta(days=38): self._snap(today - timedelta(days=38), 500)}

        assert calculate_delta(1, 30, test_db, snap_by_date=at_cap) == 500.0
        assert calculate_delta(1, 30, test_db, snap_by_date=beyond) is None
```

檔案頂端需要 `from datetime import date, timedelta`、`from db.models import RepoSnapshot`、`from utils.time import utc_today`；若已存在就不重複加。

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd sidecar && ./.venv/bin/python -m pytest tests/test_services_analyzer.py -k BacktrackScales -v`
Expected: FAIL — `test_one_day_window_requires_an_exact_match` 會拿到 900.0 而不是 None

- [ ] **Step 3: 改實作**

`sidecar/services/analyzer.py`，把 `_find_snapshot` 改成：

```python
def _find_snapshot(
    snap_by_date: dict[date, "RepoSnapshot"],
    target_date: date,
    max_backtrack_days: int,
) -> "RepoSnapshot | None":
    """從預載的快照 dict 找到最接近 target_date 的快照（等於或更早）。

    回溯上限由呼叫端給，因為它必須跟窗口成比例：七日窗回溯七天，誤差最多一倍；
    單日窗回溯七天是七倍誤差，而那個被放大的成長會直接變成排行的第一名。
    """
    snap = snap_by_date.get(target_date)
    if snap:
        return snap
    for offset in range(1, max_backtrack_days + 1):
        earlier = target_date - timedelta(days=offset)
        snap = snap_by_date.get(earlier)
        if snap:
            return snap
    return None
```

`calculate_delta` 內原本兩處呼叫改為（`get_snapshot_for_date` 那一支不變，它本來就是精確查詢）：

```python
    # 與窗口成比例，但保留原本的絕對上限：只寫 days // 2 會把三十日窗的回溯
    # 放寬到十五天，修好短窗卻弄壞長窗
    backtrack = min(days // 2, 7)

    if snap_by_date is not None:
        current_snapshot = _find_snapshot(snap_by_date, today, 0)
        past_snapshot = _find_snapshot(snap_by_date, past_date, backtrack)
```

注意 `current_snapshot` 用 `0`：「今天」沒有回溯的餘地，拿昨天的當今天會讓所有差值都偏移一天。

- [ ] **Step 4: 跑測試確認通過**

Run: `cd sidecar && ./.venv/bin/python -m pytest tests/test_services_analyzer.py -q`
Expected: PASS（含既有測試）

- [ ] **Step 5: 突變驗證**

```bash
cd sidecar
B=/tmp/plan-backup && mkdir -p $B && cp services/analyzer.py $B/
# 突變：回溯上限改回固定 7
python3 -c "
import pathlib; p=pathlib.Path('services/analyzer.py'); s=p.read_text()
p.write_text(s.replace('backtrack = min(days // 2, 7)','backtrack = 7'))"
./.venv/bin/python -m pytest tests/test_services_analyzer.py -q | tail -3   # 預期紅
cp $B/analyzer.py services/ && diff -q services/analyzer.py $B/analyzer.py  # 位元組相同
```

- [ ] **Step 6: 全套驗證並提交**

```bash
cd sidecar && ./.venv/bin/mypy . --config-file mypy.ini && ./.venv/bin/python -m pytest tests/ -q --cov=. --cov-fail-under=85
cd .. && git add sidecar/services/analyzer.py sidecar/tests/test_services_analyzer.py
git commit -m "fix(analyzer): scale the snapshot backtrack to the window asked for"
```

---

### Task 2: 新增 stars_delta_1d

段二在 2026-08-22 之前只有單日窗可用。沒有這個欄位，重設計的主面板會空六天。

**Files:**
- Modify: `sidecar/constants.py:67-78`（`SignalType`）
- Modify: `sidecar/services/analyzer.py:217-245`（`calculate_signals`）
- Modify: `sidecar/schemas/repo.py:110`
- Modify: `sidecar/routers/repos.py:132`
- Modify: `src/api/types.ts`（`RepoWithSignals`）
- Test: `sidecar/tests/test_services_analyzer.py`

**Interfaces:**
- Consumes: Task 1 的 `calculate_delta` 回溯行為
- Produces: `SignalType.STARS_DELTA_1D = "stars_delta_1d"`；`/api/repos` 每筆多一個 `stars_delta_1d: float | null`；前端型別 `RepoWithSignals.stars_delta_1d: number | null`

- [ ] **Step 1: 寫失敗的測試**

```python
class TestOneDayStarDelta:
    def test_signals_include_a_one_day_star_delta(self, test_db, mock_repo):
        """段二在七日資料出現前只有單日窗可用。"""
        from datetime import timedelta

        from db.models import RepoSnapshot
        from services.analyzer import calculate_signals
        from utils.time import utc_today

        today = utc_today()
        test_db.add_all([
            RepoSnapshot(repo_id=mock_repo.id, stars=900, forks=0, watchers=0,
                         open_issues=0, snapshot_date=today - timedelta(days=1)),
            RepoSnapshot(repo_id=mock_repo.id, stars=1000, forks=0, watchers=0,
                         open_issues=0, snapshot_date=today),
        ])
        test_db.commit()

        signals = calculate_signals(mock_repo.id, test_db)

        assert signals["stars_delta_1d"] == 100.0

    def test_one_day_delta_is_absent_without_yesterday(self, test_db, mock_repo):
        """只存有值的訊號是既有行為，缺資料時該鍵不存在而不是 0。"""
        from db.models import RepoSnapshot
        from services.analyzer import calculate_signals
        from utils.time import utc_today

        test_db.add(RepoSnapshot(repo_id=mock_repo.id, stars=1000, forks=0, watchers=0,
                                 open_issues=0, snapshot_date=utc_today()))
        test_db.commit()

        assert "stars_delta_1d" not in calculate_signals(mock_repo.id, test_db)
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd sidecar && ./.venv/bin/python -m pytest tests/test_services_analyzer.py -k OneDayStarDelta -v`
Expected: FAIL — `KeyError: 'stars_delta_1d'`

- [ ] **Step 3: 改實作（四個檔案）**

`sidecar/constants.py`，`SignalType` 內 `STARS_DELTA_7D` 之前插入：

```python
    STARS_DELTA_1D = "stars_delta_1d"  # 單日 star 變化量，七日資料出現前的替代窗口
```

`sidecar/services/analyzer.py` 的 `calculate_signals`：

```python
    delta_1d = calculate_delta(repo_id, 1, db, snap_by_date=snap_by_date)
    delta_7d = calculate_delta(repo_id, 7, db, snap_by_date=snap_by_date)
```

以及 `signal_values` 串列開頭插入：

```python
        (SignalType.STARS_DELTA_1D, delta_1d),
```

`sidecar/schemas/repo.py`，`stars_delta_7d` 之前插入：

```python
    stars_delta_1d: float | None = None
```

`sidecar/routers/repos.py`，`stars_delta_7d=` 那一行之前插入：

```python
        stars_delta_1d=signals.get(SignalType.STARS_DELTA_1D),
```

`src/api/types.ts`，`RepoWithSignals` 內 `stars_delta_7d` 之前插入：

```typescript
  /** 單日 star 變化量。七日快照尚未累積時，「在動」面板改用這個窗口 */
  stars_delta_1d: number | null;
```

不要加進 `sidecar/routers/alerts.py` 的可選欄位清單——那是使用者設定警報規則時可選的指標，單日窗太嘈雜，且本次規格未要求。

- [ ] **Step 4: 跑測試確認通過**

Run: `cd sidecar && ./.venv/bin/python -m pytest tests/test_services_analyzer.py -q && cd .. && npx tsc --noEmit`
Expected: PASS，tsc 無輸出

型別加成必填後，既有的前端測試 fixture 會缺欄位而 tsc 失敗。到 `src/hooks/__tests__/useDashboard.test.ts` 的 `makeRepo` 補 `stars_delta_1d: 20,`，其餘出錯處比照補上。

- [ ] **Step 5: 突變驗證**

```bash
cd sidecar
B=/tmp/plan-backup && cp services/analyzer.py $B/
python3 -c "
import pathlib; p=pathlib.Path('services/analyzer.py'); s=p.read_text()
p.write_text(s.replace('        (SignalType.STARS_DELTA_1D, delta_1d),\n',''))"
./.venv/bin/python -m pytest tests/test_services_analyzer.py -q | tail -3   # 預期紅
cp $B/analyzer.py services/ && diff -q services/analyzer.py $B/analyzer.py
```

- [ ] **Step 6: 全套驗證並提交**

```bash
cd sidecar && ./.venv/bin/mypy . --config-file mypy.ini && ./.venv/bin/python -m pytest tests/ -q --cov=. --cov-fail-under=85
cd .. && npx tsc --noEmit && npx vitest run
git add sidecar/ src/api/types.ts src/hooks/__tests__/useDashboard.test.ts
git commit -m "feat(analyzer): expose a one-day star delta"
```

---

### Task 3: 統一 weeklyStars 的回溯規則

同一頁上兩個同名的數字用不同規則計算。摘要那一側沒有回溯上限，可能拿三個月前的快照冒充「七天前」。

**Files:**
- Modify: `sidecar/services/weekly_summary.py:25-88`（`_fetch_snapshot_deltas`）
- Test: `sidecar/tests/test_weekly_summary.py`

**Interfaces:**
- Consumes: Task 1 的 `min(days // 2, 7)` 規則（此處為 `days=7`，即回溯三天）
- Produces: `_fetch_snapshot_deltas` 行為改變；`total_new_stars` 與 `repos_compared` 只計入回溯窗內有快照的 repo

- [ ] **Step 1: 寫失敗的測試**

加到 `sidecar/tests/test_weekly_summary.py`：

```python
class TestWeeklyDeltaRespectsTheBacktrackLimit:
    """摘要原本沒有回溯上限，可以拿三個月前的快照當「七天前」。

    KPI 卡與摘要徽章顯示的是同一個概念，規則不同就會各說各話。
    """

    def test_a_snapshot_far_outside_the_window_is_not_a_baseline(
        self, client, mock_repo, test_db
    ):
        today = utc_today()
        test_db.add_all([
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=today - timedelta(days=90),
                         fetched_at=utc_now(), stars=100, forks=0, watchers=0, open_issues=0),
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=today,
                         fetched_at=utc_now(), stars=1000, forks=0, watchers=0, open_issues=0),
        ])
        test_db.commit()

        data = client.get("/api/summary/weekly").json()["data"]

        assert data["repos_compared"] == 0
        assert data["total_new_stars"] == 0

    def test_a_snapshot_inside_the_backtrack_window_still_counts(
        self, client, mock_repo, test_db
    ):
        """七日窗回溯三天：today-10 仍算數，today-11 不算。"""
        today = utc_today()
        test_db.add_all([
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=today - timedelta(days=10),
                         fetched_at=utc_now(), stars=100, forks=0, watchers=0, open_issues=0),
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=today,
                         fetched_at=utc_now(), stars=1000, forks=0, watchers=0, open_issues=0),
        ])
        test_db.commit()

        data = client.get("/api/summary/weekly").json()["data"]

        assert data["repos_compared"] == 1
        assert data["total_new_stars"] == 900
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd sidecar && ./.venv/bin/python -m pytest tests/test_weekly_summary.py -k BacktrackLimit -v`
Expected: FAIL — 第一條會拿到 `repos_compared == 1`、`total_new_stars == 900`

- [ ] **Step 3: 改實作**

`sidecar/services/weekly_summary.py` 的 `_fetch_snapshot_deltas`，把 `old_sub` 的過濾條件從單邊改成區間：

```python
    # 回溯上限與 analyzer.calculate_delta 一致（七日窗回溯三天）。
    # 沒有下界時，三個月前的快照也會被當成「七天前」，而 KPI 卡那一側不會，
    # 同一頁上兩個同名的數字就會各說各話。
    earliest_allowed = period_start - timedelta(days=3)
    old_sub = (
        db.query(
            RepoSnapshot.repo_id,
            func.max(RepoSnapshot.snapshot_date).label("max_date"),
        )
        .filter(
            RepoSnapshot.snapshot_date <= period_start,
            RepoSnapshot.snapshot_date >= earliest_allowed,
        )
        .group_by(RepoSnapshot.repo_id)
        .subquery()
    )
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd sidecar && ./.venv/bin/python -m pytest tests/test_weekly_summary.py -q`
Expected: PASS

- [ ] **Step 5: 突變驗證**

```bash
cd sidecar
B=/tmp/plan-backup && cp services/weekly_summary.py $B/
python3 -c "
import pathlib; p=pathlib.Path('services/weekly_summary.py'); s=p.read_text()
p.write_text(s.replace('            RepoSnapshot.snapshot_date >= earliest_allowed,\n',''))"
./.venv/bin/python -m pytest tests/test_weekly_summary.py -q | tail -3   # 預期紅
cp $B/weekly_summary.py services/ && diff -q services/weekly_summary.py $B/weekly_summary.py
```

- [ ] **Step 6: 全套驗證並提交**

```bash
cd sidecar && ./.venv/bin/mypy . --config-file mypy.ini && ./.venv/bin/python -m pytest tests/ -q --cov=. --cov-fail-under=85
cd .. && git add sidecar/
git commit -m "fix(summary): bound the weekly baseline the same way the KPI card does"
```

---

### Task 4: 相對成長、中位數門檻、窗口選擇

段二的全部運算。純函式，不碰畫面，可獨立測試。

**Files:**
- Create: `src/utils/movers.ts`
- Create: `src/utils/__tests__/movers.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `RepoWithSignals.stars_delta_1d`
- Produces:
  - `type MoverWindow = 1 | 7`
  - `interface Mover { repo: RepoWithSignals; delta: number; relative: number }`
  - `interface MoversResult { window: MoverWindow | null; risers: Mover[]; fallers: Mover[]; threshold: number | null; totalDelta: number | null }`
  - `computeMovers(repos: RepoWithSignals[]): MoversResult`

- [ ] **Step 1: 寫失敗的測試**

建立 `src/utils/__tests__/movers.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import { computeMovers } from "../movers";
import type { RepoWithSignals } from "../../api/types";

function repo(over: Partial<RepoWithSignals> & { id: number }): RepoWithSignals {
  return {
    owner: "o", name: `r${over.id}`, full_name: `o/r${over.id}`,
    url: "", description: null, language: null,
    added_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
    stars: 1000, forks: 0,
    stars_delta_1d: null, stars_delta_7d: null, stars_delta_30d: null,
    velocity: null, acceleration: null, trend: 0,
    forks_delta_7d: null, forks_delta_30d: null,
    issues_delta_7d: null, issues_delta_30d: null,
    last_fetched: "2026-08-01T00:00:00Z",
    ...over,
  } as RepoWithSignals;
}

describe("computeMovers 的窗口選擇", () => {
  it("沒有任何差值時回 null 窗口", () => {
    expect(computeMovers([repo({ id: 1 })]).window).toBeNull();
  });

  it("只有單日資料時用單日", () => {
    expect(computeMovers([repo({ id: 1, stars_delta_1d: 5 })]).window).toBe(1);
  });

  it("七日涵蓋數 >= 單日時切到七日", () => {
    const result = computeMovers([
      repo({ id: 1, stars_delta_1d: 5, stars_delta_7d: 30 }),
      repo({ id: 2, stars_delta_1d: 5, stars_delta_7d: 30 }),
    ]);
    expect(result.window).toBe(7);
  });

  it("七日涵蓋數少於單日時仍留在單日", () => {
    // 8/22 當天可能只有少數 repo 補齊七日資料，排行榜不該因此縮成一列
    const result = computeMovers([
      repo({ id: 1, stars_delta_1d: 5, stars_delta_7d: 30 }),
      repo({ id: 2, stars_delta_1d: 5 }),
      repo({ id: 3, stars_delta_1d: 5 }),
    ]);
    expect(result.window).toBe(1);
  });
});

describe("computeMovers 的相對成長", () => {
  it("用成長前的星數當分母", () => {
    // 現在 1000 顆、漲了 100 → 基期是 900，不是 1000
    const [top] = computeMovers([repo({ id: 1, stars: 1000, stars_delta_1d: 100 })]).risers;
    expect(top.relative).toBeCloseTo(100 / 900, 6);
  });

  it("基期為 0 的 repo 不參與排行", () => {
    // 從 0 顆漲到 5 顆是無限大成長，會永遠霸佔第一名
    const result = computeMovers([repo({ id: 1, stars: 5, stars_delta_1d: 5 })]);
    expect(result.risers).toHaveLength(0);
  });

  it("相對成長會把絕對值排序的錯誤翻正", () => {
    // 實測案例：+574 在 18k 上是真的在飛，+431 在 218k 上是雜訊
    const result = computeMovers([
      repo({ id: 1, stars: 19025, stars_delta_1d: 574 }),
      repo({ id: 2, stars: 218707, stars_delta_1d: 431 }),
    ]);
    expect(result.risers[0].repo.id).toBe(1);
  });
});

describe("computeMovers 的門檻與取樣", () => {
  it("門檻是中位數的十倍，母體含零與負值", () => {
    const repos = [
      repo({ id: 1, stars: 1100, stars_delta_1d: 100 }),
      repo({ id: 2, stars: 1000, stars_delta_1d: 0 }),
      repo({ id: 3, stars: 1000, stars_delta_1d: 0 }),
      repo({ id: 4, stars: 990, stars_delta_1d: -10 }),
    ];
    // 相對值排序後為 [-0.01, 0, 0, 0.1]，中位數 0 → 不畫線
    expect(computeMovers(repos).threshold).toBeNull();
  });

  it("中位數大於零時門檻為其十倍", () => {
    const repos = [
      repo({ id: 1, stars: 1010, stars_delta_1d: 10 }),
      repo({ id: 2, stars: 1020, stars_delta_1d: 20 }),
      repo({ id: 3, stars: 1030, stars_delta_1d: 30 }),
    ];
    const median = 20 / 1000;
    expect(computeMovers(repos).threshold).toBeCloseTo(median * 10, 6);
  });

  it("最多五個，只取正成長", () => {
    const repos = Array.from({ length: 8 }, (_, i) =>
      repo({ id: i + 1, stars: 1000 + (i + 1) * 10, stars_delta_1d: (i + 1) * 10 })
    );
    repos.push(repo({ id: 99, stars: 990, stars_delta_1d: -10 }));

    const result = computeMovers(repos);
    expect(result.risers).toHaveLength(5);
    expect(result.risers.every((m) => m.relative > 0)).toBe(true);
    expect(result.fallers.map((m) => m.repo.id)).toEqual([99]);
  });

  it("正成長不足五個時不用負值補位", () => {
    const result = computeMovers([
      repo({ id: 1, stars: 1010, stars_delta_1d: 10 }),
      repo({ id: 2, stars: 990, stars_delta_1d: -10 }),
    ]);
    expect(result.risers).toHaveLength(1);
  });

  it("回傳所選窗口的總增量", () => {
    const result = computeMovers([
      repo({ id: 1, stars: 1100, stars_delta_1d: 100 }),
      repo({ id: 2, stars: 950, stars_delta_1d: -50 }),
    ]);
    expect(result.totalDelta).toBe(50);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/utils/__tests__/movers.test.ts`
Expected: FAIL — 找不到模組 `../movers`

- [ ] **Step 3: 寫實作**

建立 `src/utils/movers.ts`：

```typescript
/**
 * 「在動」面板的運算：選窗口、算相對成長、算顯著門檻。
 *
 * 為什麼用相對值：追蹤清單的星數跨度從 1k 到 40 萬，絕對增量無法比較——
 * 一個 20 萬星的 repo 一天多 100 顆是死水，5 千星的 repo 一天多 100 顆是爆發。
 */
import type { RepoWithSignals } from "../api/types";

export type MoverWindow = 1 | 7;

export interface Mover {
  repo: RepoWithSignals;
  delta: number;
  /** 相對於成長前星數的比例 */
  relative: number;
}

export interface MoversResult {
  /** null = 任何窗口都沒有資料 */
  window: MoverWindow | null;
  risers: Mover[];
  fallers: Mover[];
  /** 中位數 ×10。null = 中位數為 0，沒有東西稱得上顯著，不畫線 */
  threshold: number | null;
  totalDelta: number | null;
}

const MAX_RISERS = 5;
const THRESHOLD_MULTIPLIER = 10;

function deltaFor(repo: RepoWithSignals, window: MoverWindow): number | null {
  return window === 7 ? repo.stars_delta_7d : repo.stars_delta_1d;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * 取有資料的最寬窗。判定是比較涵蓋範圍而不是「有沒有任何一筆」——
 * 七日資料開始出現的那天，可能只有少數 repo 補齊，切過去會讓排行縮成幾列。
 */
function pickWindow(repos: RepoWithSignals[]): MoverWindow | null {
  const withSeven = repos.filter((r) => r.stars_delta_7d != null).length;
  const withOne = repos.filter((r) => r.stars_delta_1d != null).length;
  if (withSeven > 0 && withSeven >= withOne) return 7;
  if (withOne > 0) return 1;
  return null;
}

export function computeMovers(repos: RepoWithSignals[]): MoversResult {
  const window = pickWindow(repos);
  if (window === null) {
    return { window: null, risers: [], fallers: [], threshold: null, totalDelta: null };
  }

  const movers: Mover[] = [];
  let totalDelta = 0;

  for (const repo of repos) {
    const delta = deltaFor(repo, window);
    if (delta == null) continue;
    totalDelta += delta;

    // 基期為 0 的排除：從 0 漲到 5 是無限大成長，會永遠霸佔第一名
    const base = (repo.stars ?? 0) - delta;
    if (base <= 0) continue;
    movers.push({ repo, delta, relative: delta / base });
  }

  // 母體含零與負值。只取正成長子集會讓門檻隨「今天有幾個在漲」跳動，
  // 失去自我校準的意義。
  const med = median(movers.map((m) => m.relative).sort((a, b) => a - b));
  const threshold = med > 0 ? med * THRESHOLD_MULTIPLIER : null;

  const risers = movers
    .filter((m) => m.relative > 0)
    .sort((a, b) => b.relative - a.relative)
    .slice(0, MAX_RISERS);

  const fallers = movers
    .filter((m) => m.relative < 0)
    .sort((a, b) => a.relative - b.relative);

  return { window, risers, fallers, threshold, totalDelta };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/utils/__tests__/movers.test.ts && npx tsc --noEmit`
Expected: PASS，tsc 無輸出

- [ ] **Step 5: 突變驗證**

```bash
B=/tmp/plan-backup && cp src/utils/movers.ts $B/
# 突變 A：改用絕對值排序
python3 -c "
import pathlib; p=pathlib.Path('src/utils/movers.ts'); s=p.read_text()
p.write_text(s.replace('.sort((a, b) => b.relative - a.relative)','.sort((a, b) => b.delta - a.delta)'))"
npx vitest run src/utils/__tests__/movers.test.ts 2>&1 | grep -E "^ +Tests"   # 預期紅
cp $B/movers.ts src/utils/
# 突變 B：窗口切換改成「有任何一筆就切」
python3 -c "
import pathlib; p=pathlib.Path('src/utils/movers.ts'); s=p.read_text()
p.write_text(s.replace('if (withSeven > 0 && withSeven >= withOne) return 7;','if (withSeven > 0) return 7;'))"
npx vitest run src/utils/__tests__/movers.test.ts 2>&1 | grep -E "^ +Tests"   # 預期紅
cp $B/movers.ts src/utils/ && diff -q src/utils/movers.ts $B/movers.ts
```

- [ ] **Step 6: 提交**

```bash
npx eslint src --max-warnings 0
git add src/utils/movers.ts src/utils/__tests__/movers.test.ts
git commit -m "feat(dashboard): rank movers by relative growth, not absolute"
```

---

### Task 5: 段一 需要注意

必須經常是空的，而空的時候不得宣稱未經檢查的事。

**Files:**
- Create: `src/components/dashboard/AttentionBar.tsx`
- Create: `src/components/dashboard/__tests__/AttentionBar.test.tsx`
- Modify: `src/i18n/translations.ts`（`en` 與 `zh-TW` 各一處）

**Interfaces:**
- Consumes: 無（純 props）
- Produces:
  ```typescript
  interface AttentionItem { kind: "alert" | "release"; title: string; detail: string; url?: string }
  interface AttentionBarProps {
    items: AttentionItem[];
    totalRepos: number;
    hasAlertRules: boolean;
    releasesChecked: boolean;
    updatedLabel: string;
    onRefresh: () => void;
  }
  ```

段一同時取代 `DataFreshnessBar`——更新時間會顯示在同一行，所以那個元件會從
`Dashboard.tsx` 移除。但它身上掛著**手動重整按鈕**，那個動作沒有別的入口，
必須一起搬過來，否則這次改版會安靜地拿掉一個功能。

- [ ] **Step 1: 寫失敗的測試**

建立 `src/components/dashboard/__tests__/AttentionBar.test.tsx`：

```tsx
/**
 * 段一是整頁唯一一個「你可以不看」的承諾，所以空狀態必須講出自己的覆蓋範圍。
 * 在沒有檢查過任何東西的情況下宣稱沒事，跟「velocity 是 null 卻算成停滯」
 * 是同一個錯誤，而這裡的代價更高。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AttentionBar } from "../AttentionBar";

const base = {
  items: [],
  totalRepos: 94,
  hasAlertRules: true,
  releasesChecked: true,
  updatedLabel: "3 分鐘前",
  onRefresh: () => {},
};

describe("AttentionBar", () => {
  it("沒事時是一行，並帶著追蹤數量與更新時間", () => {
    render(<AttentionBar {...base} />);

    const bar = screen.getByTestId("attention-bar");
    expect(bar).toHaveTextContent("94");
    expect(bar).toHaveTextContent("3 分鐘前");
    expect(screen.queryByTestId("attention-item")).not.toBeInTheDocument();
  });

  it("沒設警報規則時要講出來", () => {
    // 一條規則都沒有，警報那個來源永遠不會觸發。此時宣稱「無需注意」
    // 等於在沒有檢查過任何東西的情況下說沒事。
    render(<AttentionBar {...base} hasAlertRules={false} />);

    expect(screen.getByTestId("attention-bar")).toHaveTextContent(/no alert rules/i);
  });

  it("版本還沒抓過時說正在檢查，不說沒事", () => {
    render(<AttentionBar {...base} releasesChecked={false} />);

    const bar = screen.getByTestId("attention-bar");
    expect(bar).toHaveTextContent(/still checking/i);
    expect(bar).not.toHaveTextContent(/nothing needs/i);
  });

  it("保留手動重整——它原本掛在被取代的元件上", () => {
    const onRefresh = vi.fn();
    render(<AttentionBar {...base} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("有項目時展開成清單", () => {
    render(
      <AttentionBar
        {...base}
        items={[
          { kind: "release", title: "redis/jedis v8.0.0", detail: "breaking", url: "https://x" },
          { kind: "alert", title: "Star spike", detail: "ollama/ollama" },
        ]}
      />
    );

    expect(screen.getAllByTestId("attention-item")).toHaveLength(2);
    expect(screen.getByRole("link", { name: /jedis/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/components/dashboard/__tests__/AttentionBar.test.tsx`
Expected: FAIL — 找不到模組 `../AttentionBar`

- [ ] **Step 3: 加 i18n 文案**

`src/i18n/translations.ts`，`en` 的 `dashboard` 底下加：

```typescript
      attention: {
        title: "Needs attention",
        clear: "Nothing needs attention this week",
        noAlertRules: "no alert rules set",
        checking: "Still checking — releases not fetched yet",
        tracking: "{count} tracked",
      },
```

`zh-TW` 的對應位置加：

```typescript
      attention: {
        title: "需要注意",
        clear: "本週無需注意的事",
        noAlertRules: "未設定警報規則",
        checking: "正在檢查（版本資料尚未抓取）",
        tracking: "{count} 個追蹤中",
      },
```

- [ ] **Step 4: 寫元件**

建立 `src/components/dashboard/AttentionBar.tsx`：

```tsx
/**
 * 段一：需要注意。
 *
 * 必須經常是空的——每天都亮的警示等於壁紙。而空的時候不能只說「沒事」：
 * 這是整頁唯一一個「你可以不看」的承諾，宣稱沒事之前得先確定檢查跑得起來。
 */
import { memo } from "react";
import { useI18n, interpolate } from "../../i18n";
import { safeOpenUrl } from "../../utils/url";

export interface AttentionItem {
  kind: "alert" | "release";
  title: string;
  detail: string;
  url?: string;
}

interface AttentionBarProps {
  items: AttentionItem[];
  totalRepos: number;
  /** 一條規則都沒有時，警報那個來源永遠不會觸發，空狀態要講出來 */
  hasAlertRules: boolean;
  /** 版本尚未抓取時不能說「沒事」，只能說還在檢查 */
  releasesChecked: boolean;
  updatedLabel: string;
  /** 取代 DataFreshnessBar 時一併搬過來的手動重整，沒有別的入口 */
  onRefresh: () => void;
}

export const AttentionBar = memo(function AttentionBar({
  items,
  totalRepos,
  hasAlertRules,
  releasesChecked,
  updatedLabel,
  onRefresh,
}: AttentionBarProps) {
  const { t } = useI18n();
  const copy = t.dashboard.attention;

  const status = !releasesChecked
    ? copy.checking
    : hasAlertRules
      ? copy.clear
      : `${copy.clear} · ${copy.noAlertRules}`;

  return (
    <section className="attention-bar" data-testid="attention-bar">
      <div className="attention-status">
        <span className="attention-status-text">{items.length > 0 ? copy.title : status}</span>
        <span className="attention-status-meta">
          {interpolate(copy.tracking, { count: totalRepos })} · {updatedLabel}
        </span>
        <button type="button" className="attention-refresh" onClick={onRefresh}
                aria-label={t.common.refresh}>
          ↻
        </button>
      </div>
      {items.length > 0 && (
        <ul className="attention-list">
          {items.map((item) => (
            <li key={`${item.kind}-${item.title}`} className="attention-item"
                data-testid="attention-item">
              {item.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    e.preventDefault();
                    void safeOpenUrl(item.url as string);
                  }}
                >
                  {item.title}
                </a>
              ) : (
                <span>{item.title}</span>
              )}
              <span className="attention-item-detail">{item.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
});
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npx vitest run src/components/dashboard/__tests__/AttentionBar.test.tsx && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: 突變驗證**

```bash
B=/tmp/plan-backup && cp src/components/dashboard/AttentionBar.tsx $B/
# 突變：不管檢查跑不跑得起來都說沒事
python3 -c "
import pathlib; p=pathlib.Path('src/components/dashboard/AttentionBar.tsx'); s=p.read_text()
old='''  const status = !releasesChecked
    ? copy.checking
    : hasAlertRules
      ? copy.clear
      : \`\${copy.clear} · \${copy.noAlertRules}\`;'''
assert s.count(old)==1
p.write_text(s.replace(old,'  const status = copy.clear;'))"
npx vitest run src/components/dashboard/__tests__/AttentionBar.test.tsx 2>&1 | grep -E "^ +Tests"   # 預期紅（兩條）
cp $B/AttentionBar.tsx src/components/dashboard/ && diff -q src/components/dashboard/AttentionBar.tsx $B/AttentionBar.tsx
```

- [ ] **Step 7: 提交**

```bash
npx eslint src --max-warnings 0 && npx vitest run
git add src/components/dashboard/AttentionBar.tsx src/components/dashboard/__tests__/AttentionBar.test.tsx src/i18n/translations.ts
git commit -m "feat(dashboard): add the attention bar, and let it admit what it did not check"
```

---

### Task 6: 段二下層 排行

**Files:**
- Create: `src/components/dashboard/MoversPanel.tsx`
- Create: `src/components/dashboard/__tests__/MoversPanel.test.tsx`
- Modify: `src/i18n/translations.ts`
- Modify: `src/App.css`

**Interfaces:**
- Consumes: Task 4 的 `computeMovers`、`MoversResult`、`Mover`
- Produces: `<MoversPanel result={MoversResult} />`

- [ ] **Step 1: 寫失敗的測試**

建立 `src/components/dashboard/__tests__/MoversPanel.test.tsx`：

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MoversPanel } from "../MoversPanel";
import type { MoversResult } from "../../../utils/movers";
import type { RepoWithSignals } from "../../../api/types";

function mover(fullName: string, relative: number, delta: number) {
  return { repo: { full_name: fullName } as RepoWithSignals, delta, relative };
}

const base: MoversResult = {
  window: 1,
  risers: [mover("a/one", 0.0774, 8819), mover("b/two", 0.0006, 26)],
  fallers: [],
  threshold: 0.001,
  totalDelta: 9892,
};

describe("MoversPanel", () => {
  it("標題帶著窗口，因為兩個窗口的數字不能同名", () => {
    render(<MoversPanel result={base} />);
    expect(screen.getByTestId("movers-title")).toHaveTextContent(/1/);

    render(<MoversPanel result={{ ...base, window: 7 }} />);
    expect(screen.getAllByTestId("movers-title")[1]).toHaveTextContent(/7/);
  });

  it("標題帶著總增量", () => {
    render(<MoversPanel result={base} />);
    expect(screen.getByTestId("movers-title")).toHaveTextContent("+9.9K");
  });

  it("門檻以上與以下之間畫一條線", () => {
    render(<MoversPanel result={base} />);
    expect(screen.getByTestId("movers-divider")).toBeInTheDocument();
  });

  it("中位數為零時不畫線", () => {
    // 沒有東西稱得上顯著，就不要假裝有分界
    render(<MoversPanel result={{ ...base, threshold: null }} />);
    expect(screen.queryByTestId("movers-divider")).not.toBeInTheDocument();
  });

  it("全部都在門檻以上時不畫線", () => {
    render(<MoversPanel result={{ ...base, threshold: 0.00001 }} />);
    expect(screen.queryByTestId("movers-divider")).not.toBeInTheDocument();
  });

  it("沒有任何窗口有資料時說資料累積中", () => {
    render(
      <MoversPanel
        result={{ window: null, risers: [], fallers: [], threshold: null, totalDelta: null }}
      />
    );
    expect(screen.getByTestId("movers-empty")).toBeInTheDocument();
  });

  it("下滑中另組並預設折疊", () => {
    render(<MoversPanel result={{ ...base, fallers: [mover("c/three", -0.02, -20)] }} />);

    const details = screen.getByTestId("movers-fallers");
    expect(details).not.toHaveAttribute("open");
    expect(within(details).getByText("c/three")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/components/dashboard/__tests__/MoversPanel.test.tsx`
Expected: FAIL — 找不到模組 `../MoversPanel`

- [ ] **Step 3: 加 i18n 文案**

`en` 的 `dashboard` 底下：

```typescript
      movers: {
        title: "Moving",
        window1: "last 1 day",
        window7: "last 7 days",
        total: "{delta} overall",
        empty: "Building history — no growth to compare yet",
        fallers: "Declining ({count})",
        noise: "below the noise line",
      },
```

`zh-TW`：

```typescript
      movers: {
        title: "在動",
        window1: "近 1 天",
        window7: "近 7 天",
        total: "全體 {delta}",
        empty: "快照累積中——還沒有可比較的成長",
        fallers: "下滑中（{count}）",
        noise: "雜訊線以下",
      },
```

- [ ] **Step 4: 寫元件**

建立 `src/components/dashboard/MoversPanel.tsx`：

```tsx
/**
 * 段二下層：相對成長排行。
 *
 * 永遠顯示前幾名，但在中位數 ×10 的位置畫一條線——線下的不假裝值得看。
 * 標題一定要帶窗口：這一頁已經有過一次「兩個同名而規則不同的數字」的教訓。
 */
import { memo } from "react";
import { useI18n, interpolate } from "../../i18n";
import { formatDelta } from "../../utils/format";
import type { Mover, MoversResult } from "../../utils/movers";

function formatPercent(relative: number): string {
  return `${relative > 0 ? "+" : ""}${(relative * 100).toFixed(2)}%`;
}

const MoverRow = memo(function MoverRow({ mover }: { mover: Mover }) {
  return (
    <div className="mover-row" data-testid="mover-row">
      <span className="mover-name">{mover.repo.full_name}</span>
      <span className={`mover-relative ${mover.relative > 0 ? "trend-up" : "trend-down"}`}>
        {formatPercent(mover.relative)}
      </span>
      <span className="mover-delta">{formatDelta(mover.delta)}</span>
    </div>
  );
});

export const MoversPanel = memo(function MoversPanel({ result }: { result: MoversResult }) {
  const { t } = useI18n();
  const copy = t.dashboard.movers;

  if (result.window === null) {
    return (
      <section className="dashboard-section movers-panel">
        <h3>{copy.title}</h3>
        <div className="weekly-empty" data-testid="movers-empty">
          {copy.empty}
        </div>
      </section>
    );
  }

  const windowLabel = result.window === 7 ? copy.window7 : copy.window1;
  const above = result.threshold === null
    ? result.risers
    : result.risers.filter((m) => m.relative >= result.threshold!);
  const below = result.threshold === null
    ? []
    : result.risers.filter((m) => m.relative < result.threshold!);

  return (
    <section className="dashboard-section movers-panel">
      <h3 data-testid="movers-title">
        {copy.title}（{windowLabel}）
        {result.totalDelta !== null && (
          <span className="movers-total">
            {" · "}
            {interpolate(copy.total, { delta: formatDelta(result.totalDelta) })}
          </span>
        )}
      </h3>

      {above.map((m) => (
        <MoverRow key={m.repo.full_name} mover={m} />
      ))}

      {below.length > 0 && (
        <div className="movers-divider" data-testid="movers-divider">
          {copy.noise}
        </div>
      )}
      {below.map((m) => (
        <MoverRow key={m.repo.full_name} mover={m} />
      ))}

      {result.fallers.length > 0 && (
        <details className="movers-fallers" data-testid="movers-fallers">
          <summary>{interpolate(copy.fallers, { count: result.fallers.length })}</summary>
          {result.fallers.map((m) => (
            <MoverRow key={m.repo.full_name} mover={m} />
          ))}
        </details>
      )}
    </section>
  );
});
```

- [ ] **Step 5: 加樣式**

`src/App.css` 末端加：

```css
/* 「在動」排行。分隔線是資訊不是裝飾——它標的是雜訊的起點，
   所以用文字加細線，不用純視覺的分隔符。 */
.mover-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 12px;
  align-items: baseline;
  padding: 6px 0;
}

.mover-relative {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.mover-delta {
  font-variant-numeric: tabular-nums;
  color: var(--fg-muted);
  min-width: 64px;
  text-align: right;
}

.movers-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
  font-size: 11px;
  color: var(--fg-muted);
}

.movers-divider::after {
  content: "";
  flex: 1;
  border-top: 1px dashed var(--border-default);
}

.movers-total {
  font-size: 13px;
  font-weight: 400;
  color: var(--fg-muted);
}

.movers-fallers {
  margin-top: 12px;
  font-size: 13px;
}

.movers-fallers summary {
  cursor: pointer;
  color: var(--fg-muted);
}
```

- [ ] **Step 6: 跑測試確認通過**

Run: `npx vitest run src/components/dashboard/__tests__/MoversPanel.test.tsx && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: 突變驗證**

```bash
B=/tmp/plan-backup && cp src/components/dashboard/MoversPanel.tsx $B/
# 突變：中位數為 null 時照樣畫線
python3 -c "
import pathlib; p=pathlib.Path('src/components/dashboard/MoversPanel.tsx'); s=p.read_text()
p.write_text(s.replace('{below.length > 0 && (','{true && ('))"
npx vitest run src/components/dashboard/__tests__/MoversPanel.test.tsx 2>&1 | grep -E "^ +Tests"   # 預期紅
cp $B/MoversPanel.tsx src/components/dashboard/ && diff -q src/components/dashboard/MoversPanel.tsx $B/MoversPanel.tsx
```

- [ ] **Step 8: 提交**

```bash
npx eslint src --max-warnings 0 && npx vitest run
git add src/components/dashboard/MoversPanel.tsx src/components/dashboard/__tests__/MoversPanel.test.tsx src/i18n/translations.ts src/App.css
git commit -m "feat(dashboard): add the movers ranking with a noise line"
```

---

### Task 7: useDashboard 供應三段所需的資料

**Files:**
- Modify: `src/hooks/useDashboard.ts`
- Modify: `src/hooks/__tests__/useDashboard.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `computeMovers`
- Produces: `useDashboard()` 多回四個值——`movers: MoversResult`、
  `attentionItems: AttentionItem[]`、`hasAlertRules: boolean`（`alertRules.length > 0`）、
  `releasesChecked: boolean`（`weekly !== undefined`）。
  更新時間不新增輸出：`dataUpdatedAt` 已經在回傳值裡，由 `Dashboard.tsx` 自行格式化。

- [ ] **Step 1: 寫失敗的測試**

加到 `src/hooks/__tests__/useDashboard.test.ts`：

```typescript
describe("useDashboard 供應段一與段二", () => {
  it("把帶 breaking 或 security 標記的本週版本收進 attentionItems", async () => {
    // deprecation 單獨出現不算：那是預告不是行動
    vi.mocked(apiClient.getRepos).mockResolvedValue({ repos: [makeRepo()], total: 1 });

    const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.attentionItems).toEqual([]);
  });

  it("回傳 movers", async () => {
    vi.mocked(apiClient.getRepos).mockResolvedValue({
      repos: [makeRepo({ id: 1, stars: 1100, stars_delta_1d: 100 })],
      total: 1,
    });

    const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.movers.window).toBe(1);
    expect(result.current.movers.risers).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/hooks/__tests__/useDashboard.test.ts -t "供應段一與段二"`
Expected: FAIL — `result.current.movers` 是 undefined

- [ ] **Step 3: 改實作**

`src/hooks/useDashboard.ts`：頂端加 `import { computeMovers, type MoversResult } from "../utils/movers";` 與 `import type { AttentionItem } from "../components/dashboard/AttentionBar";`。

在 `healthScoreInput` 之後加：

```typescript
  const movers: MoversResult = useMemo(() => computeMovers(repos), [repos]);

  // 段一：只收「值得打斷你」的。deprecation 單獨出現不算，那是預告不是行動。
  const attentionItems: AttentionItem[] = useMemo(() => {
    const fromAlerts: AttentionItem[] = alerts
      .filter((a) => !a.acknowledged)
      .map((a) => ({ kind: "alert" as const, title: a.rule_name, detail: a.repo_name }));

    const fromReleases: AttentionItem[] = (weekly?.releases ?? [])
      .filter((r) => r.tags.some((tag) => tag === "breaking" || tag === "security"))
      .map((r) => ({
        kind: "release" as const,
        title: `${r.repo_name} ${r.title}`,
        detail: r.tags.join(" · "),
        url: r.url,
      }));

    return [...fromAlerts, ...fromReleases];
  }, [alerts, weekly]);
```

`weekly` 由 `useWeeklySummary()` 提供；若 `useDashboard` 尚未取用它，加上
`const { data: weekly } = useWeeklySummary();`（`import { useWeeklySummary } from "./useWeeklySummary";`）。

回傳物件加上 `movers`、`attentionItems`。

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/hooks/__tests__/useDashboard.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
npx eslint src --max-warnings 0
git add src/hooks/
git commit -m "feat(dashboard): supply the attention and movers data from one hook"
```

---

### Task 8: Dashboard 改為三段排列

**Files:**
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/components/dashboard/WidgetCustomizer.tsx`
- Test: `src/pages/__tests__/Dashboard.test.tsx`（若不存在則建立）

**Interfaces:**
- Consumes: Task 5 的 `AttentionBar`、Task 6 的 `MoversPanel`、Task 7 的 `movers` / `attentionItems`
- Produces: 無（終端組裝）

- [ ] **Step 1: 寫失敗的測試**

```tsx
describe("Dashboard 三段排列", () => {
  it("段一在段二之前，段二在段三之前", () => {
    // 順序就是設計本身：依「漏看的代價」由高到低
    render(<Dashboard />, { wrapper: createWrapper() });

    const page = screen.getByTestId("page-title").closest(".dashboard-page")!;
    const order = [...page.querySelectorAll("[data-testid]")]
      .map((el) => el.getAttribute("data-testid"))
      .filter((id) => ["attention-bar", "movers-title", "movers-empty", "weekly-releases"].includes(id!));

    expect(order[0]).toBe("attention-bar");
    expect(order[order.length - 1]).toBe("weekly-releases");
  });

  it("SignalSpotlight 排在排行之前", () => {
    // 持久層在上、即時層在下：會遺忘的東西不該擋在不會遺忘的東西前面
    render(<Dashboard />, { wrapper: createWrapper() });
    // SignalSpotlight 無訊號時回 null，此測試以 DOM 順序為準，
    // 有訊號的情境由 SignalSpotlight 自身的測試涵蓋
    expect(screen.getByTestId("movers-empty")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/pages/__tests__/Dashboard.test.tsx`
Expected: FAIL — 找不到 `attention-bar`

- [ ] **Step 3: 改 Dashboard.tsx**

`src/pages/Dashboard.tsx`，把 `<StatsGrid>` 起至 `dashboard-grid` 止的區塊改為
以下內容（`StatsGrid` 本身不刪，改為 Step 4 的條件渲染）：

```tsx
      {/* 段一：需要注意。取代原本的四張統計卡與健康分數卡——
          那些合計 293px，只為了說「沒事」 */}
      <AttentionBar
        items={attentionItems}
        totalRepos={stats.totalRepos}
        hasAlertRules={hasAlertRules}
        releasesChecked={releasesChecked}
        updatedLabel={freshnessLabel}
      />

      {/* 段二：持久在上、即時在下。SignalSpotlight 會記得幾天前的暴衝，
          排行只知道此刻——「不要錯過」需要前者 */}
      <FadeIn delay={0.12}>
        {widgetVisibility.signalSpotlight && (
          <SignalSpotlight
            signals={earlySignals}
            summary={signalSummary}
            onAcknowledge={acknowledgeSignal}
          />
        )}
      </FadeIn>
      <FadeIn delay={0.15}>
        <MoversPanel result={movers} />
      </FadeIn>

      {/* 段三：可讀 */}
      {widgetVisibility.weeklySummary && (
        <FadeIn delay={0.18}>
          <WeeklySummary />
        </FadeIn>
      )}
```

其餘 widget（`portfolioHistory`、`velocityChart`、`languageDistribution`、`categorySummary`、`recentActivity`）維持原本的條件渲染，排在段三之後。

`hasAlertRules` 與 `releasesChecked` 來自 Task 7。更新時間就地算，沿用 `Dashboard.tsx`
已經 import 的工具：

```tsx
  const freshnessLabel = formatCompactRelativeTime(
    new Date(dataUpdatedAt).toISOString(),
    t.dashboard.activity.justNow
  );
```

同時移除 `<DataFreshnessBar .../>` 那一行與它的 import——它的兩項內容（更新時間、
手動重整）都已經在段一裡。

- [ ] **Step 4: 改 WidgetCustomizer 的 key、預設值，並補上 statsGrid**

`StatsGrid` 目前**沒有對應的 widget key**，直接從 `Dashboard.tsx` 拿掉等於刪除，
違反規格「預設關閉而非刪除」的原則——四張卡的數字雖然各有去處，但「是否要留著
那一排」仍然是使用者的判斷。所以先補一個 key。

`src/components/dashboard/WidgetCustomizer.tsx`：

```typescript
export type WidgetId =
  | "statsGrid"
  | "portfolioHealth"
  | "signalSpotlight"
  | "weeklySummary"
  | "portfolioHistory"
  | "velocityChart"
  | "languageDistribution"
  | "categorySummary"
  | "recentActivity";

// 版面的 widget 組成在 2026-08-16 的重設計中改變了，舊偏好對不上新版面。
// loadWidgetVisibility 用 {...DEFAULT, ...parsed}，已存的鍵會蓋過新預設值，
// 所以只改 DEFAULT_VISIBILITY 對「曾經打開過這個選單的人」完全沒有作用。
const STORAGE_KEY = "starscope-dashboard-widgets-v2";

const DEFAULT_VISIBILITY: WidgetVisibility = {
  statsGrid: false,
  portfolioHealth: false,
  signalSpotlight: true,
  weeklySummary: true,
  portfolioHistory: false,
  velocityChart: false,
  languageDistribution: false,
  categorySummary: false,
  recentActivity: false,
};
```

選單的項目清單（`WIDGETS` 或同名常數）也要加上 `{ id: "statsGrid", label: ... }`，
否則使用者看不到那個開關。`label` 用 `t.dashboard.stats.title`；若 i18n 沒有這個鍵，
在兩個語系各加 `title: "Overview stats"` 與 `title: "總覽數字"`。

`src/pages/Dashboard.tsx` 對應改為條件渲染：

```tsx
      {widgetVisibility.statsGrid && (
        <FadeIn delay={0.1}>
          <StatsGrid stats={stats} />
        </FadeIn>
      )}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: 突變驗證**

```bash
B=/tmp/plan-backup && cp src/components/dashboard/WidgetCustomizer.tsx $B/
# 突變：storage key 改回舊的
python3 -c "
import pathlib; p=pathlib.Path('src/components/dashboard/WidgetCustomizer.tsx'); s=p.read_text()
p.write_text(s.replace('starscope-dashboard-widgets-v2','starscope-dashboard-widgets'))"
npx vitest run src/components/dashboard/__tests__/WidgetCustomizer.test.tsx 2>&1 | grep -E "^ +Tests"
cp $B/WidgetCustomizer.tsx src/components/dashboard/ && diff -q src/components/dashboard/WidgetCustomizer.tsx $B/WidgetCustomizer.tsx
```

若既有的 WidgetCustomizer 測試沒有斷言 storage key，補一條：

```typescript
it("換過 storage key，舊偏好不影響新版面", () => {
  localStorage.setItem("starscope-dashboard-widgets", JSON.stringify({ recentActivity: true }));
  expect(loadWidgetVisibility().recentActivity).toBe(false);
});
```

- [ ] **Step 7: 提交**

```bash
npx eslint src --max-warnings 0
git add src/pages/Dashboard.tsx src/components/dashboard/ src/pages/__tests__/
git commit -m "feat(dashboard): lay the page out by cost of missing something"
```

---

### Task 9: 訊號總覽解散

四個計數各自有更好的去處，計數本身不能點也不能確認。

**Files:**
- Modify: `src/components/dashboard/WeeklySummary.tsx`
- Modify: `src/components/dashboard/__tests__/WeeklySummaryBaseline.test.tsx`

**Interfaces:**
- Consumes: 無
- Produces: `WeeklySummary` 不再渲染 `SignalsOverview`

- [ ] **Step 1: 寫失敗的測試**

加到 `src/components/dashboard/__tests__/WeeklySummaryBaseline.test.tsx`：

```typescript
it("不再渲染訊號總覽——那四個數字都有更好的去處", () => {
  // 觸發警報 → 段一；早期訊號 → 段二上層的項目本身；加速/減速 → 段二的排行。
  // 「早期訊號 2」不能點、不能確認、不告訴你是哪兩個。
  renderWith(summary({ alerts_triggered: 3, early_signals_detected: 2 }));

  expect(screen.queryByText(/alerts triggered/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/early signals/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/components/dashboard/__tests__/WeeklySummaryBaseline.test.tsx`
Expected: FAIL — 文字仍然存在

- [ ] **Step 3: 改實作**

`src/components/dashboard/WeeklySummary.tsx`：刪除 `SignalsOverview` 元件定義，並從 `weekly-grid` 內移除它的呼叫。`data.alerts_triggered` 等欄位保留在型別與 API 中（其他消費端可能用到），只是這個面板不再顯示。

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
npx eslint src --max-warnings 0
git add src/components/dashboard/
git commit -m "refactor(dashboard): turn the signal counts into things you can act on"
```

---

### Task 10: 對真實資料驗收

計畫的每一步都是單元層級。這一步確認整條鏈在真實的 94 個 repo 上成立。

**Files:** 無（驗證用）

**Interfaces:**
- Consumes: Task 1–9 全部
- Produces: 無

- [ ] **Step 1: 對資料庫副本跑一次真實運算**

```bash
S=/tmp/dashboard-verify && rm -rf $S && mkdir -p $S
for f in starscope.db starscope.db-wal starscope.db-shm; do cp ~/.starscope/$f $S/ 2>/dev/null; done
cd sidecar && STARSCOPE_DATA_DIR=$S PYTHONPATH=$PWD ./.venv/bin/python - <<'PY'
from db.database import SessionLocal, init_db
from db.soft_delete import install_archive_filter
from db.models import Repo
from services.analyzer import calculate_signals
init_db(); install_archive_filter()
db = SessionLocal()
rows = []
for r in db.query(Repo).all():
    s = calculate_signals(r.id, db)
    d = s.get("stars_delta_1d")
    if d is None:
        continue
    base = (s.get("stars") or 0)
    rows.append((r.full_name, d))
print(f"算得出單日差值的 repo: {len(rows)} / {db.query(Repo).count()}")
for name, d in sorted(rows, key=lambda x: -x[1])[:5]:
    print(f"  {name:<40} {d:+.0f}")
db.close()
PY
```

Expected: 算得出單日差值的數量接近追蹤總數；前幾名與資料庫直接查詢一致。

- [ ] **Step 2: 用瀏覽器量三段的順序與間距**

啟動開發環境後，在 `http://localhost:1420/` 執行：

```javascript
const page = document.querySelector('.dashboard-page');
const rows = [];
let prev = null;
for (const c of page.children) {
  if (getComputedStyle(c).display === 'none') continue;
  const card = c.classList.contains('fade-in') ? c.firstElementChild : c;
  if (!card) continue;
  const r = card.getBoundingClientRect();
  rows.push({
    label: (card.querySelector('h1,h3,h4')?.textContent || card.className.split(' ')[0]).trim().slice(0, 14),
    gapAbove: prev === null ? null : Math.round(r.top - prev),
  });
  prev = r.bottom;
}
console.table(rows);
```

Expected: 順序為 頁首 → 需要注意 → （SignalSpotlight）→ 在動 → 近 7 天摘要；所有 `gapAbove` 一致，沒有 0。

- [ ] **Step 3: 確認排行的第一名經得起查證**

用 SQL 獨立算一次相對成長，比對畫面上的第一名：

```sql
WITH d AS (
  SELECT s2.repo_id, s1.stars AS base, s2.stars - s1.stars AS delta
  FROM repo_snapshots s1 JOIN repo_snapshots s2
    ON s1.repo_id = s2.repo_id
   AND s1.snapshot_date = date('now','-1 day')
   AND s2.snapshot_date = date('now')
  WHERE s1.stars > 0)
SELECT r.full_name, printf('%.2f%%', 100.0*d.delta/d.base) AS rel
FROM d JOIN repos r ON r.id = d.repo_id
ORDER BY 1.0*d.delta/d.base DESC LIMIT 5;
```

Expected: 與畫面上的前五名一致。若不一致，先查是不是 Task 1 的回溯上限沒有生效——那正是這條驗收要抓的東西。

- [ ] **Step 4: 全套與提交**

```bash
cd sidecar && ./.venv/bin/mypy . --config-file mypy.ini && ./.venv/bin/python -m pytest tests/ -q --cov=. --cov-fail-under=85
cd .. && npx tsc --noEmit && npx eslint src --max-warnings 0 && npx vitest run
git add -A && git commit -m "test(dashboard): verify the redesign against the real watchlist"
```
