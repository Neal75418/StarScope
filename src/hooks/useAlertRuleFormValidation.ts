/**
 * Alert Rule 表單驗證邏輯。
 */

import { useCallback } from "react";
import type { AlertRuleCreate } from "../api/client";
import { useI18n } from "../i18n";

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
  const { t } = useI18n();

  const validate = useCallback((): ValidationResult => {
    const trimmedName = rule.name.trim();

    if (!trimmedName) {
      return { valid: false, error: t.settings.alerts.validation.nameRequired };
    }

    if (!rule.signal_type) {
      return { valid: false, error: t.settings.alerts.validation.signalTypeRequired };
    }

    if (!Number.isFinite(rule.threshold)) {
      return { valid: false, error: t.settings.alerts.validation.thresholdInvalid };
    }

    if (!applyToAll && rule.repo_id === undefined) {
      return { valid: false, error: t.settings.alerts.validation.selectRepo };
    }

    return { valid: true };
  }, [rule, applyToAll, t]);

  return { validate };
}
