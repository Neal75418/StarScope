import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAlertRuleFormValidation } from "../useAlertRuleFormValidation";
import type { AlertRuleCreate } from "../../api/types";

function makeRule(overrides: Partial<AlertRuleCreate> = {}): AlertRuleCreate {
  return {
    name: "Test Rule",
    signal_type: "stars_velocity",
    operator: ">",
    threshold: 100,
    enabled: true,
    repo_id: 1,
    ...overrides,
  };
}

describe("useAlertRuleFormValidation", () => {
  it("returns valid for a complete rule", () => {
    const rule = makeRule();
    const { result } = renderHook(() => useAlertRuleFormValidation(rule, false));

    const validation = result.current.validate();
    expect(validation.valid).toBe(true);
    expect(validation.error).toBeUndefined();
  });

  it("returns error when name is empty", () => {
    const rule = makeRule({ name: "" });
    const { result } = renderHook(() => useAlertRuleFormValidation(rule, false));

    const validation = result.current.validate();
    expect(validation.valid).toBe(false);
    expect(validation.error).toContain("Name");
  });

  it("returns error when name is whitespace only", () => {
    const rule = makeRule({ name: "   " });
    const { result } = renderHook(() => useAlertRuleFormValidation(rule, false));

    const validation = result.current.validate();
    expect(validation.valid).toBe(false);
  });

  it("returns error when signal_type is empty", () => {
    const rule = makeRule({ signal_type: "" });
    const { result } = renderHook(() => useAlertRuleFormValidation(rule, false));

    const validation = result.current.validate();
    expect(validation.valid).toBe(false);
    expect(validation.error).toContain("Signal type");
  });

  it("returns error when threshold is NaN", () => {
    const rule = makeRule({ threshold: NaN });
    const { result } = renderHook(() => useAlertRuleFormValidation(rule, false));

    const validation = result.current.validate();
    expect(validation.valid).toBe(false);
    expect(validation.error).toContain("Threshold");
  });

  it("returns error when threshold is Infinity", () => {
    const rule = makeRule({ threshold: Infinity });
    const { result } = renderHook(() => useAlertRuleFormValidation(rule, false));

    const validation = result.current.validate();
    expect(validation.valid).toBe(false);
  });

  it("accepts zero threshold", () => {
    const rule = makeRule({ threshold: 0 });
    const { result } = renderHook(() => useAlertRuleFormValidation(rule, false));

    const validation = result.current.validate();
    expect(validation.valid).toBe(true);
  });

  it("returns error when repo_id missing and not applyToAll", () => {
    const rule = makeRule({ repo_id: undefined });
    const { result } = renderHook(() => useAlertRuleFormValidation(rule, false));

    const validation = result.current.validate();
    expect(validation.valid).toBe(false);
    expect(validation.error).toContain("Repo");
  });

  it("allows missing repo_id when applyToAll is true", () => {
    const rule = makeRule({ repo_id: undefined });
    const { result } = renderHook(() => useAlertRuleFormValidation(rule, true));

    const validation = result.current.validate();
    expect(validation.valid).toBe(true);
  });

  it("accepts negative threshold", () => {
    const rule = makeRule({ threshold: -10 });
    const { result } = renderHook(() => useAlertRuleFormValidation(rule, false));

    const validation = result.current.validate();
    expect(validation.valid).toBe(true);
  });
});
