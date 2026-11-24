/**
 * Regression tests for AlertRuleForm component.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { AlertRuleForm } from "../AlertRuleForm";
import type { AlertRuleCreate, SignalTypeInfo, RepoWithSignals } from "../../../api/client";

const mockSignalTypes: SignalTypeInfo[] = [
  { type: "velocity", name: "Velocity", description: "Star velocity" },
];

const mockRepos: RepoWithSignals[] = [];

const defaultRule: AlertRuleCreate = {
  name: "Test Alert",
  signal_type: "velocity",
  operator: ">",
  threshold: 10,
  enabled: true,
};

describe("AlertRuleForm", () => {
  const mockOnSubmit = vi.fn<(rule: AlertRuleCreate) => Promise<boolean>>();
  const mockOnCancel = vi.fn<() => void>();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderForm(overrides: Partial<Parameters<typeof AlertRuleForm>[0]> = {}) {
    return render(
      <AlertRuleForm
        initialData={defaultRule}
        signalTypes={mockSignalTypes}
        repos={mockRepos}
        isSubmitting={false}
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        {...overrides}
      />
    );
  }

  it("disables cancel button while submitting", () => {
    renderForm({ isSubmitting: true });

    const cancelBtn = screen.getByRole("button", { name: /Cancel|取消/ });
    expect(cancelBtn).toBeDisabled();
  });

  it("enables cancel button when not submitting", () => {
    renderForm({ isSubmitting: false });

    const cancelBtn = screen.getByRole("button", { name: /Cancel|取消/ });
    expect(cancelBtn).not.toBeDisabled();
  });

  it("does not call onCancel when cancel is clicked during submit", async () => {
    const user = userEvent.setup();
    renderForm({ isSubmitting: true });

    const cancelBtn = screen.getByRole("button", { name: /Cancel|取消/ });
    await user.click(cancelBtn);

    expect(mockOnCancel).not.toHaveBeenCalled();
  });

  it("calls onCancel only after successful submit", async () => {
    const user = userEvent.setup();
    mockOnSubmit.mockResolvedValue(true);
    renderForm();

    await user.click(screen.getByRole("button", { name: /Create Alert|建立警報/ }));

    await waitFor(() => {
      expect(mockOnCancel).toHaveBeenCalled();
    });
  });

  it("does not call onCancel when submit fails", async () => {
    const user = userEvent.setup();
    mockOnSubmit.mockResolvedValue(false);
    renderForm();

    await user.click(screen.getByRole("button", { name: /Create Alert|建立警報/ }));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalled();
    });
    expect(mockOnCancel).not.toHaveBeenCalled();
  });

  it("hands no repo to the save once All Repositories is picked for a rule that watched one", async () => {
    // 沒有 repo_id＝套用到所有儲存庫；更新時由 useAlertRuleOperations 轉成 null 送出
    const user = userEvent.setup();
    mockOnSubmit.mockResolvedValue(true);
    renderForm({
      initialData: { ...defaultRule, repo_id: 3 },
      repos: [{ id: 3, full_name: "facebook/react" } as RepoWithSignals],
      isEditMode: true,
    });

    await user.click(screen.getByRole("radio", { name: /All Repositories|全部儲存庫/ }));
    await user.click(screen.getByRole("button", { name: /^(Save|儲存)$/ }));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    });
    expect(mockOnSubmit.mock.calls[0][0].repo_id).toBeUndefined();
  });
});
