/**
 * Alert Rule 表單驗證邏輯。
 */

import { useCallback } from "react";
import { AlertRuleCreate } from "../api/client";

interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function useAlertRuleFormValidation(
  rule: AlertRuleCreate,
  applyToAll: boolean
): {
  validate: () => ValidationResult;
} {
  const validate = useCallback((): ValidationResult => {
    const trimmedName = rule.name.trim();

    if (!trimmedName) {
      return { valid: false, error: "名稱必填" };
    }

    if (!rule.signal_type) {
      return { valid: false, error: "訊號類型必填" };
    }

    if (!Number.isFinite(rule.threshold)) {
      return { valid: false, error: "閾值必填且必須為有效數字" };
    }

    if (!applyToAll && rule.repo_id === undefined) {
      return { valid: false, error: "請選擇 Repo" };
    }

    return { valid: true };
  }, [rule, applyToAll]);

  return { validate };
}
