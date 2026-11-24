/**
 * 警示規則列表元件。
 */

import { memo, useId } from "react";
import type { AlertRule } from "../../api/client";
import { useI18n } from "../../i18n";

interface AlertRuleCardProps {
  rule: AlertRule;
  isEditing: boolean;
  onToggle: (id: number) => void;
  onEdit: (rule: AlertRule) => void;
  onDelete: (id: number) => void;
}

interface AlertRuleListProps {
  rules: AlertRule[];
  /** 正在編輯的規則：它的啟用／停用鈕與刪除鈕鎖住，啟用與否只看編輯框 */
  editingRuleId: number | null;
  onToggle: (id: number) => void;
  onEdit: (rule: AlertRule) => void;
  onDelete: (id: number) => void;
}

const AlertRuleCard = memo(function AlertRuleCard({
  rule,
  isEditing,
  onToggle,
  onEdit,
  onDelete,
}: AlertRuleCardProps) {
  const { t } = useI18n();
  const editingBadgeId = useId();

  // 取得翻譯後的條件名稱
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
          {isEditing && (
            <span id={editingBadgeId} className="alert-rule-status editing">
              {t.settings.alerts.status.editing}
            </span>
          )}
        </div>
        <div className="alert-rule-condition">
          {getConditionLabel(rule.signal_type)} {rule.operator} {rule.threshold}
        </div>
        <div className="alert-rule-target">
          {rule.repo_name ? rule.repo_name : t.settings.alerts.form.allRepos}
        </div>
      </div>
      {/* 編輯中鎖住啟用／停用與刪除：編輯框存檔時整包送出（含啟用），清單上切換同一條再存檔會被改回去；
          刪掉的話編輯框還開著，存檔打到已經不在的規則。鎖住的鈕不在 Tab 順序裡，「編輯中」掛在編輯鈕的
          描述上，只按 Tab 的報讀軟體使用者才聽得到為什麼跳過 */}
      <div className="alert-rule-actions">
        <button
          className="btn btn-sm"
          disabled={isEditing}
          onClick={() => onToggle(rule.id)}
          aria-label={`${rule.enabled ? t.settings.alerts.actions.disable : t.settings.alerts.actions.enable} ${rule.name}`}
        >
          {rule.enabled ? t.settings.alerts.actions.disable : t.settings.alerts.actions.enable}
        </button>
        <button
          className="btn btn-sm"
          onClick={() => onEdit(rule)}
          aria-label={`${t.common.edit} ${rule.name}`}
          aria-describedby={isEditing ? editingBadgeId : undefined}
        >
          {t.common.edit}
        </button>
        <button
          className="btn btn-sm btn-danger"
          disabled={isEditing}
          onClick={() => onDelete(rule.id)}
          aria-label={`${t.common.delete} ${rule.name}`}
        >
          {t.common.delete}
        </button>
      </div>
    </div>
  );
});

export function AlertRuleList({
  rules,
  editingRuleId,
  onToggle,
  onEdit,
  onDelete,
}: AlertRuleListProps) {
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
          isEditing={rule.id === editingRuleId}
          onToggle={onToggle}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
