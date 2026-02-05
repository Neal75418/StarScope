/**
 * Alert rule list component.
 */

import { memo } from "react";
import { AlertRule } from "../../api/client";
import { useI18n } from "../../i18n";

interface AlertRuleCardProps {
  rule: AlertRule;
  onToggle: (id: number) => void;
  onEdit: (rule: AlertRule) => void;
  onDelete: (id: number) => void;
}

interface AlertRuleListProps {
  rules: AlertRule[];
  onToggle: (id: number) => void;
  onEdit: (rule: AlertRule) => void;
  onDelete: (id: number) => void;
}

const AlertRuleCard = memo(function AlertRuleCard({
  rule,
  onToggle,
  onEdit,
  onDelete,
}: AlertRuleCardProps) {
  const { t } = useI18n();

  // Get translated condition name
  const getConditionLabel = (signalType: string): string => {
    const conditionKey = signalType as keyof typeof t.settings.alerts.conditions;
    if (t.settings.alerts.conditions[conditionKey]) {
      return t.settings.alerts.conditions[conditionKey];
    }
    return signalType.replace(/_/g, " ");
  };

  return (
    <div className={`alert-rule-card ${rule.enabled ? "" : "disabled"}`}>
      <div className="alert-rule-info">
        <div className="alert-rule-header">
          <span className="alert-rule-name">{rule.name}</span>
          <span className={`alert-rule-status ${rule.enabled ? "enabled" : "disabled"}`}>
            {rule.enabled ? t.settings.alerts.status.enabled : t.settings.alerts.status.disabled}
          </span>
        </div>
        <div className="alert-rule-condition">
          {getConditionLabel(rule.signal_type)} {rule.operator} {rule.threshold}
        </div>
        <div className="alert-rule-target">
          {rule.repo_name ? rule.repo_name : t.settings.alerts.form.allRepos}
        </div>
      </div>
      <div className="alert-rule-actions">
        <button className="btn btn-sm" onClick={() => onToggle(rule.id)}>
          {rule.enabled ? t.settings.alerts.actions.disable : t.settings.alerts.actions.enable}
        </button>
        <button className="btn btn-sm" onClick={() => onEdit(rule)}>
          {t.common.edit}
        </button>
        <button className="btn btn-sm btn-danger" onClick={() => onDelete(rule.id)}>
          {t.common.delete}
        </button>
      </div>
    </div>
  );
});

export function AlertRuleList({ rules, onToggle, onEdit, onDelete }: AlertRuleListProps) {
  const { t } = useI18n();

  if (rules.length === 0) {
    return <div className="alert-rule-empty">{t.settings.alerts.noAlerts}</div>;
  }

  return (
    <div className="alert-rule-list">
      {rules.map((rule) => (
        <AlertRuleCard
          key={rule.id}
          rule={rule}
          onToggle={onToggle}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
