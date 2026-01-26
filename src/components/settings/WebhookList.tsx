/**
 * Webhook list component.
 */

import { Webhook } from "../../api/client";
import { useI18n } from "../../i18n";

interface WebhookListProps {
  webhooks: Webhook[];
  testingId: number | null;
  onTest: (id: number) => void;
  onToggle: (id: number) => void;
  onEdit: (webhook: Webhook) => void;
  onDelete: (id: number) => void;
  onViewLogs: (id: number) => void;
}

function WebhookCard({
  webhook,
  testingId,
  onTest,
  onToggle,
  onEdit,
  onDelete,
  onViewLogs,
}: {
  webhook: Webhook;
  testingId: number | null;
  onTest: (id: number) => void;
  onToggle: (id: number) => void;
  onEdit: (webhook: Webhook) => void;
  onDelete: (id: number) => void;
  onViewLogs: (id: number) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="webhook-card">
      <div className="webhook-info">
        <div className="webhook-header">
          <span className="webhook-name">{webhook.name}</span>
          <span className={`webhook-type ${webhook.webhook_type}`}>{webhook.webhook_type}</span>
          <span className={`webhook-status ${webhook.enabled ? "enabled" : "disabled"}`}>
            {webhook.enabled
              ? t.settings.webhooks.status.enabled
              : t.settings.webhooks.status.disabled}
          </span>
        </div>
        <div className="webhook-url">{webhook.url}</div>
        <div className="webhook-triggers">
          {t.settings.webhooks.labels.triggers}: {webhook.triggers.join(", ").replace(/_/g, " ")}
        </div>
        {webhook.last_error && (
          <div className="webhook-error">
            {t.settings.webhooks.labels.lastError}: {webhook.last_error}
          </div>
        )}
      </div>
      <div className="webhook-actions">
        <button
          className="btn btn-sm"
          onClick={() => onTest(webhook.id)}
          disabled={testingId === webhook.id}
        >
          {testingId === webhook.id
            ? t.settings.webhooks.actions.testing
            : t.settings.webhooks.actions.test}
        </button>
        <button className="btn btn-sm" onClick={() => onToggle(webhook.id)}>
          {webhook.enabled
            ? t.settings.webhooks.actions.disable
            : t.settings.webhooks.actions.enable}
        </button>
        <button className="btn btn-sm" onClick={() => onEdit(webhook)}>
          {t.settings.webhooks.actions.edit}
        </button>
        <button className="btn btn-sm" onClick={() => onViewLogs(webhook.id)}>
          {t.settings.webhooks.actions.logs}
        </button>
        <button className="btn btn-sm btn-danger" onClick={() => onDelete(webhook.id)}>
          {t.settings.webhooks.actions.delete}
        </button>
      </div>
    </div>
  );
}

export function WebhookList({ webhooks, testingId, onTest, onToggle, onEdit, onDelete, onViewLogs }: WebhookListProps) {
  const { t } = useI18n();

  if (webhooks.length === 0) {
    return <div className="webhook-empty">{t.settings.webhooks.empty}</div>;
  }

  return (
    <div className="webhook-list">
      {webhooks.map((webhook) => (
        <WebhookCard
          key={webhook.id}
          webhook={webhook}
          testingId={testingId}
          onTest={onTest}
          onToggle={onToggle}
          onEdit={onEdit}
          onDelete={onDelete}
          onViewLogs={onViewLogs}
        />
      ))}
    </div>
  );
}
