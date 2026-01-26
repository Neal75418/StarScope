/**
 * Modal for viewing webhook execution logs.
 */

import { WebhookLog } from "../../api/client";
import { useI18n } from "../../i18n";

// Sub-component for individual log item
function LogItem({ log }: { log: WebhookLog }) {
  const { t } = useI18n();
  const statusClass = log.success ? "success" : "error";

  return (
    <div className={`webhook-log-item ${statusClass}`}>
      <div className="log-header">
        <span className={`log-status ${statusClass}`}>{log.success ? "✓" : "✗"}</span>
        <span className="log-trigger">{log.trigger_type}</span>
        <span className="log-time">{new Date(log.sent_at).toLocaleString()}</span>
      </div>
      <div className="log-details">
        <div className="log-response">
          <strong>{t.settings.webhooks.logs.statusCode}:</strong> {log.status_code ?? "N/A"}
        </div>
        {log.error_message && (
          <div className="log-error">
            <strong>{t.settings.webhooks.logs.error}:</strong> {log.error_message}
          </div>
        )}
      </div>
    </div>
  );
}

// Sub-component for logs content
function LogsContent({ logs, isLoading }: { logs: WebhookLog[]; isLoading: boolean }) {
  const { t } = useI18n();

  if (isLoading) {
    return <div className="loading">{t.settings.webhooks.logs.loading}</div>;
  }

  if (logs.length === 0) {
    return <div className="empty">{t.settings.webhooks.logs.empty}</div>;
  }

  return (
    <div className="webhook-logs-list">
      {logs.map((log) => (
        <LogItem key={log.id} log={log} />
      ))}
    </div>
  );
}

interface WebhookLogsModalProps {
  webhookName: string;
  logs: WebhookLog[];
  isLoading: boolean;
  onClose: () => void;
}

export function WebhookLogsModal({ webhookName, logs, isLoading, onClose }: WebhookLogsModalProps) {
  const { t } = useI18n();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal webhook-logs-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            {t.settings.webhooks.logs.title}: {webhookName}
          </h3>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-content">
          <LogsContent logs={logs} isLoading={isLoading} />
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {t.common.close}
          </button>
        </div>
      </div>
    </div>
  );
}
