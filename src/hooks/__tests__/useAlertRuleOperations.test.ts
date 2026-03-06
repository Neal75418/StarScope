import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../../api/client", () => ({
  createAlertRule: vi.fn(),
  updateAlertRule: vi.fn(),
  deleteAlertRule: vi.fn(),
  checkAlerts: vi.fn(),
  acknowledgeAllTriggeredAlerts: vi.fn(),
}));

vi.mock("../../utils/error", () => ({
  getErrorMessage: (err: unknown, fallback: string) =>
    err instanceof Error ? err.message : fallback,
}));

import {
  createAlertRule,
  updateAlertRule,
  deleteAlertRule,
  checkAlerts,
  acknowledgeAllTriggeredAlerts,
} from "../../api/client";
import { useAlertRuleOperations } from "../useAlertRuleOperations";
import type { Toast } from "../types";
import type { AlertRule } from "../../api/types";

const mockCreateAlertRule = vi.mocked(createAlertRule);
const mockUpdateAlertRule = vi.mocked(updateAlertRule);
const mockDeleteAlertRule = vi.mocked(deleteAlertRule);
const mockCheckAlerts = vi.mocked(checkAlerts);
const mockAcknowledgeAll = vi.mocked(acknowledgeAllTriggeredAlerts);

function makeRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 1,
    name: "Test Rule",
    signal_type: "stars_velocity",
    operator: "gt",
    threshold: 100,
    enabled: true,
    created_at: "2024-01-01",
    updated_at: "2024-01-01",
    ...overrides,
  } as AlertRule;
}

describe("useAlertRuleOperations", () => {
  let mockToast: Toast;
  let mockLoadRules: () => Promise<void>;
  let rules: AlertRule[];
  let setRules: React.Dispatch<React.SetStateAction<AlertRule[]>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockToast = { success: vi.fn(), error: vi.fn() };
    mockLoadRules = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    rules = [makeRule({ id: 1, enabled: true }), makeRule({ id: 2, enabled: false })];
    setRules = vi.fn<React.Dispatch<React.SetStateAction<AlertRule[]>>>((updater) => {
      if (typeof updater === "function") {
        rules = (updater as (prev: AlertRule[]) => AlertRule[])(rules);
      }
    });
  });

  function renderOps() {
    return renderHook(() =>
      useAlertRuleOperations({
        rules,
        setRules,
        loadRules: mockLoadRules,
        toast: mockToast,
      })
    );
  }

  it("handleCreate calls createAlertRule and reloads", async () => {
    mockCreateAlertRule.mockResolvedValue(undefined as never);

    const { result } = renderOps();

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.handleCreate({
        name: "New",
        signal_type: "stars",
        operator: "gt",
        threshold: 50,
      } as never);
    });

    expect(success).toBe(true);
    expect(mockCreateAlertRule).toHaveBeenCalled();
    expect(mockLoadRules).toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalled();
  });

  it("handleUpdate calls updateAlertRule and reloads", async () => {
    mockUpdateAlertRule.mockResolvedValue(undefined as never);

    const { result } = renderOps();

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.handleUpdate(1, {
        name: "Updated",
        signal_type: "stars",
        operator: "gt",
        threshold: 200,
      } as never);
    });

    expect(success).toBe(true);
    expect(mockUpdateAlertRule).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ name: "Updated" })
    );
    expect(mockLoadRules).toHaveBeenCalled();
  });

  it("handleDelete calls deleteAlertRule and reloads", async () => {
    mockDeleteAlertRule.mockResolvedValue(undefined as never);

    const { result } = renderOps();

    await act(async () => {
      await result.current.handleDelete(1);
    });

    expect(mockDeleteAlertRule).toHaveBeenCalledWith(1);
    expect(mockLoadRules).toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalled();
  });

  it("handleToggle optimistically updates then calls API", async () => {
    mockUpdateAlertRule.mockResolvedValue(undefined as never);

    const { result } = renderOps();

    await act(async () => {
      await result.current.handleToggle(1);
    });

    // Optimistic update: setRules called with toggled enabled
    expect(setRules).toHaveBeenCalled();
    expect(mockUpdateAlertRule).toHaveBeenCalledWith(1, { enabled: false });
  });

  it("handleToggle reverts on API failure", async () => {
    mockUpdateAlertRule.mockRejectedValue(new Error("API error"));

    const { result } = renderOps();

    await act(async () => {
      await result.current.handleToggle(1);
    });

    // setRules called twice: optimistic + revert
    expect(setRules).toHaveBeenCalledTimes(2);
    expect(mockToast.error).toHaveBeenCalled();
  });

  it("handleToggle does nothing for non-existent rule", async () => {
    const { result } = renderOps();

    await act(async () => {
      await result.current.handleToggle(999);
    });

    expect(mockUpdateAlertRule).not.toHaveBeenCalled();
  });

  it("handleCheckNow calls checkAlerts", async () => {
    mockCheckAlerts.mockResolvedValue(undefined as never);

    const { result } = renderOps();

    await act(async () => {
      await result.current.handleCheckNow();
    });

    expect(mockCheckAlerts).toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalled();
  });

  it("handleAcknowledgeAll calls acknowledgeAllTriggeredAlerts", async () => {
    mockAcknowledgeAll.mockResolvedValue(undefined as never);

    const { result } = renderOps();

    await act(async () => {
      await result.current.handleAcknowledgeAll();
    });

    expect(mockAcknowledgeAll).toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalled();
  });
});
