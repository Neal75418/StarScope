/**
 * Alert rule creation/edit form component.
 */

import { useState, useEffect, FormEvent } from "react";
import { AlertOperator, AlertRuleCreate, SignalTypeInfo, RepoWithSignals } from "../../api/client";
import { useI18n } from "../../i18n";

interface AlertRuleFormProps {
  initialData: AlertRuleCreate;
  signalTypes: SignalTypeInfo[];
  repos: RepoWithSignals[];
  isSubmitting: boolean;
  isEditMode?: boolean;
  onSubmit: (rule: AlertRuleCreate) => Promise<boolean>;
  onCancel: () => void;
}

const OPERATORS: { value: AlertOperator; label: string }[] = [
  { value: ">", label: ">" },
  { value: "<", label: "<" },
  { value: ">=", label: ">=" },
  { value: "<=", label: "<=" },
  { value: "==", label: "==" },
];

export function AlertRuleForm({
  initialData,
  signalTypes,
  repos,
  isSubmitting,
  isEditMode = false,
  onSubmit,
  onCancel,
}: AlertRuleFormProps) {
  const { t } = useI18n();
  const [rule, setRule] = useState<AlertRuleCreate>(initialData);
  const [applyToAll, setApplyToAll] = useState(initialData.repo_id === undefined);

  // Reset form when initialData changes (for edit mode)
  useEffect(() => {
    setRule(initialData);
    setApplyToAll(initialData.repo_id === undefined);
  }, [initialData]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    const trimmedName = rule.name.trim();
    if (!trimmedName || !rule.signal_type) return;
    if (!Number.isFinite(rule.threshold)) return;
    if (!applyToAll && rule.repo_id === undefined) return;

    const ruleData: AlertRuleCreate = {
      ...rule,
      name: trimmedName,
      repo_id: applyToAll ? undefined : rule.repo_id,
    };

    const success = await onSubmit(ruleData);
    if (success) {
      // Parent component handles closing the form and resetting state
      // Form will receive fresh initialData when reopened
      onCancel();
    }
  };

  // Get translated signal type name
  const getSignalTypeLabel = (type: string): string => {
    const conditionKey = type as keyof typeof t.settings.alerts.conditions;
    if (t.settings.alerts.conditions[conditionKey]) {
      return t.settings.alerts.conditions[conditionKey];
    }
    const signalType = signalTypes.find((s) => s.type === type);
    return signalType?.name ?? type;
  };

  return (
    <form className="alert-rule-form" onSubmit={handleSubmit}>
      <div className="form-row">
        <div className="form-group">
          <label>{t.settings.alerts.form.name}</label>
          <input
            type="text"
            value={rule.name}
            onChange={(e) => setRule({ ...rule, name: e.target.value })}
            placeholder={t.settings.alerts.form.namePlaceholder}
            required
          />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>{t.settings.alerts.form.condition}</label>
          <select
            value={rule.signal_type}
            onChange={(e) => setRule({ ...rule, signal_type: e.target.value })}
          >
            {signalTypes.map((type) => (
              <option key={type.type} value={type.type}>
                {getSignalTypeLabel(type.type)}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group form-group-small">
          <label>&nbsp;</label>
          <select
            value={rule.operator}
            onChange={(e) => setRule({ ...rule, operator: e.target.value as AlertOperator })}
          >
            {OPERATORS.map((op) => (
              <option key={op.value} value={op.value}>
                {op.label}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group form-group-small">
          <label>{t.settings.alerts.form.threshold}</label>
          <input
            type="number"
            value={rule.threshold}
            onChange={(e) => setRule({ ...rule, threshold: parseFloat(e.target.value) || 0 })}
            step="any"
            required
          />
        </div>
      </div>

      <div className="form-group">
        <label>{t.settings.alerts.form.repos}</label>
        <div className="repo-select-options">
          <label className="radio-option">
            <input
              type="radio"
              name="repoScope"
              checked={applyToAll}
              onChange={() => {
                setApplyToAll(true);
                setRule({ ...rule, repo_id: undefined });
              }}
            />
            {t.settings.alerts.form.allRepos}
          </label>
          <label className="radio-option">
            <input
              type="radio"
              name="repoScope"
              checked={!applyToAll}
              onChange={() => setApplyToAll(false)}
            />
            {t.settings.alerts.form.selectedRepos}
          </label>
        </div>
        {!applyToAll && (
          <select
            value={rule.repo_id ?? ""}
            onChange={(e) =>
              setRule({ ...rule, repo_id: e.target.value ? parseInt(e.target.value) : undefined })
            }
            className="repo-select"
          >
            <option value="">--</option>
            {repos.map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.full_name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="form-group">
        <label className="checkbox-option">
          <input
            type="checkbox"
            checked={rule.enabled ?? true}
            onChange={(e) => setRule({ ...rule, enabled: e.target.checked })}
          />
          {t.settings.alerts.form.enabled}
        </label>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
          {isSubmitting
            ? isEditMode
              ? t.common.save + "..."
              : t.settings.alerts.create + "..."
            : isEditMode
              ? t.common.save
              : t.settings.alerts.create}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {t.common.cancel}
        </button>
      </div>
    </form>
  );
}
