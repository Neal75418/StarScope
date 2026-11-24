/**
 * AlertRuleList：正在編輯的那一條，啟用／停用鈕與刪除鈕鎖住、標示編輯中；其他條不受影響。
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AlertRuleList } from "../AlertRuleList";
import type { AlertRule } from "../../../api/client";

function makeRule(overrides: Partial<AlertRule>): AlertRule {
  return {
    id: 1,
    name: "Rule A",
    description: null,
    repo_id: null,
    repo_name: null,
    signal_type: "velocity",
    operator: ">",
    threshold: 10,
    enabled: true,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    ...overrides,
  };
}

const rules = [makeRule({}), makeRule({ id: 2, name: "Rule B" })];

function renderList(editingRuleId: number | null, list: AlertRule[] = rules) {
  return render(
    <AlertRuleList
      rules={list}
      editingRuleId={editingRuleId}
      onToggle={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
    />
  );
}

describe("AlertRuleList", () => {
  it("locks the switch and delete of the rule being edited", () => {
    renderList(1);

    expect(screen.getByRole("button", { name: "Disable Rule A" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete Rule A" })).toBeDisabled();
    // 編輯鈕不鎖：「編輯中」掛在它的描述上，鎖了就跟著離開 Tab 順序
    expect(screen.getByRole("button", { name: "Edit Rule A" })).toBeEnabled();
  });

  it("leaves the other rules alone", () => {
    renderList(1);

    expect(screen.getByRole("button", { name: "Disable Rule B" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Delete Rule B" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Edit Rule B" })).toBeEnabled();
  });

  it("marks only the rule being edited", () => {
    renderList(1);

    const cardA = screen.getByText("Rule A").closest(".alert-rule-card") as HTMLElement;
    const cardB = screen.getByText("Rule B").closest(".alert-rule-card") as HTMLElement;
    expect(within(cardA).getByText("Editing")).toBeInTheDocument();
    expect(within(cardB).queryByText("Editing")).toBeNull();
  });

  it("locks the enable button too when the rule being edited is switched off", () => {
    // 反方向的同一個問題：在清單啟用、存檔時編輯框又把它停用
    renderList(1, [makeRule({ enabled: false }), makeRule({ id: 2, name: "Rule B" })]);

    expect(screen.getByRole("button", { name: "Enable Rule A" })).toBeDisabled();
    const cardA = screen.getByText("Rule A").closest(".alert-rule-card") as HTMLElement;
    expect(within(cardA).getByText("Editing")).toBeInTheDocument();
  });

  it("tells keyboard users why the rule's other buttons are skipped", () => {
    // 停用的鈕不在 Tab 順序裡：只按 Tab 的話從「編輯」直接跳到下一條，所以把「編輯中」掛在編輯鈕的描述上
    renderList(1);

    expect(screen.getByRole("button", { name: "Edit Rule A" })).toHaveAccessibleDescription(
      "Editing"
    );
    expect(screen.getByRole("button", { name: "Edit Rule B" })).not.toHaveAccessibleDescription();
    // 算出來的描述為空不夠：指到不存在的 id 也算出空的，要確認根本沒掛
    expect(screen.getByRole("button", { name: "Edit Rule B" })).not.toHaveAttribute(
      "aria-describedby"
    );
  });

  it("locks nothing when no rule is being edited", () => {
    renderList(null);

    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeEnabled();
    }
    expect(screen.queryByText("Editing")).toBeNull();
  });
});
