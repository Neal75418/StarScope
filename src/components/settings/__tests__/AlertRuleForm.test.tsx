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
  let mockOnSubmit: ReturnType<typeof vi.fn>;
  let mockOnCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnSubmit = vi.fn();
    mockOnCancel = vi.fn();
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
});
