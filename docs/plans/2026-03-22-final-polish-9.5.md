# Final Polish: 9.3 → 9.5

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the last 3 gaps: DropdownMenu a11y, regression tests for recent fixes, E2E smoke confidence.

**Architecture:** All 3 items are independent. No new features — only completing and guarding existing work.

**Tech Stack:** React 19, TypeScript, Vitest, Playwright

---

## Current State

| Item | What Exists | What's Missing |
|------|------------|----------------|
| DropdownMenu | role="menu", ESC close, focus return | Arrow keys, auto-focus first item on open |
| Regression tests | 0 for DropdownMenu, 0 for RecommendedForYou, Settings nav untested | 3 test files needed |
| E2E smoke | 6 specs, 24 tests, CI running | Confirm all pass, no known flakes |

---

## Task 1: DropdownMenu — complete menu keyboard model

**Files:**
- Modify: `src/components/DropdownMenu.tsx`

**Decision:** Implement arrow key navigation (not downgrade semantics). Only 2 consumers, each with 2 items — the implementation is simple.

**What to add:**
1. Auto-focus first menuitem when menu opens
2. ArrowDown/ArrowUp cycles through menuitems
3. Home/End jump to first/last

**Implementation:**

```typescript
// After menu opens, focus first menuitem
useEffect(() => {
  if (!open) return;
  const menu = ref.current?.querySelector('[role="menu"]');
  const first = menu?.querySelector<HTMLElement>('[role="menuitem"]');
  first?.focus();
}, [open]);

// Keyboard handler on the menu container
const handleMenuKeyDown = useCallback((e: React.KeyboardEvent) => {
  const menu = ref.current?.querySelector('[role="menu"]');
  if (!menu) return;
  const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  const current = document.activeElement as HTMLElement;
  const index = items.indexOf(current);

  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      items[(index + 1) % items.length]?.focus();
      break;
    case "ArrowUp":
      e.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
      break;
    case "Home":
      e.preventDefault();
      items[0]?.focus();
      break;
    case "End":
      e.preventDefault();
      items[items.length - 1]?.focus();
      break;
  }
}, []);
```

Add `onKeyDown={handleMenuKeyDown}` to the menu `<div>`.

**Commit:** `feat: complete DropdownMenu keyboard navigation (arrow/home/end)`

---

## Task 2: Regression tests

### 2a: DropdownMenu.test.tsx

**Files:**
- Create: `src/components/__tests__/DropdownMenu.test.tsx`

**Tests to write:**
1. Opens on click, closes on second click
2. Closes on ESC key
3. Returns focus to trigger button on close
4. Auto-focuses first menuitem on open
5. ArrowDown moves focus to next item
6. ArrowUp wraps to last item
7. Home/End jump to first/last

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DropdownMenu } from "../DropdownMenu";

describe("DropdownMenu", () => {
  const renderMenu = () =>
    render(
      <DropdownMenu label="Export" buttonTestId="trigger" menuTestId="menu">
        {(close) => (
          <>
            <a role="menuitem" href="#" onClick={close}>JSON</a>
            <a role="menuitem" href="#" onClick={close}>CSV</a>
          </>
        )}
      </DropdownMenu>
    );

  it("opens and closes on trigger click", async () => {
    renderMenu();
    const trigger = screen.getByTestId("trigger");
    await userEvent.click(trigger);
    expect(screen.getByTestId("menu")).toBeInTheDocument();
    await userEvent.click(trigger);
    expect(screen.queryByTestId("menu")).not.toBeInTheDocument();
  });

  it("closes on ESC and returns focus to trigger", async () => {
    renderMenu();
    await userEvent.click(screen.getByTestId("trigger"));
    expect(screen.getByTestId("menu")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("menu")).not.toBeInTheDocument();
    expect(screen.getByTestId("trigger")).toHaveFocus();
  });

  it("auto-focuses first menuitem on open", async () => {
    renderMenu();
    await userEvent.click(screen.getByTestId("trigger"));
    expect(screen.getByText("JSON")).toHaveFocus();
  });

  it("ArrowDown moves focus to next item", async () => {
    renderMenu();
    await userEvent.click(screen.getByTestId("trigger"));
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByText("CSV")).toHaveFocus();
  });

  it("ArrowUp from first wraps to last", async () => {
    renderMenu();
    await userEvent.click(screen.getByTestId("trigger"));
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByText("CSV")).toHaveFocus();
  });
});
```

### 2b: RecommendedForYou.test.tsx

**Files:**
- Create: `src/components/discovery/__tests__/RecommendedForYou.test.tsx`

**Tests:**
1. Renders repo name as `<a>` with correct href
2. Dismiss button calls onDismiss
3. Add button calls onAddToWatchlist

### 2c: Settings nav active test

**Files:**
- Modify: `src/pages/__tests__/Settings.test.tsx`

**Test:** Verify nav buttons render with correct class. Cannot test IntersectionObserver in jsdom (guarded), so test that nav items exist and are clickable.

**Commit:** `test: add DropdownMenu, RecommendedForYou, Settings nav regression tests`

---

## Task 3: E2E smoke confidence

**Files:**
- Read: `.github/workflows/test.yml` (verify E2E job)
- Review: All 6 spec files for flaky patterns

**What to do:**
1. Run E2E locally to verify all 24 tests pass
2. Check last 3 CI runs for E2E job status
3. If any flaky, fix or skip with documented reason
4. Confirm CI E2E is the "smoke gate" — not comprehensive, but guards the critical paths

**Commit:** Only if fixes needed

---

## Execution Summary

| Task | Est. | Risk | Dependencies |
|------|------|------|-------------|
| 1: DropdownMenu keyboard | 15m | Low | None |
| 2a: DropdownMenu tests | 10m | Low | After Task 1 |
| 2b: RecommendedForYou tests | 10m | Low | None |
| 2c: Settings nav test | 5m | Low | None |
| 3: E2E smoke verify | 5m | Low | None |

**Total: 5 sub-tasks, ~45 minutes**

**Critical path:** Task 1 → Task 2a (tests depend on keyboard implementation)
