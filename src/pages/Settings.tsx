/**
 * Settings page - export data and manage webhooks.
 */

import { useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ToastContainer, useToast } from "../components/Toast";
import { GitHubConnection } from "../components/GitHubConnection";
import { ExportSection, WebhookForm, WebhookList, WebhookLogsModal } from "../components/settings";
import { useWebhooks } from "../hooks/useWebhooks";
import { useI18n } from "../i18n";

export function Settings() {
  const { t } = useI18n();
  const toast = useToast();
  const [showAddWebhook, setShowAddWebhook] = useState(false);
  const webhooks = useWebhooks(toast);

  // Determine if we're in create or edit mode
  const isFormVisible = showAddWebhook || webhooks.editingWebhook !== null;
  const isEditMode = webhooks.editingWebhook !== null;

  const handleCancelForm = () => {
    setShowAddWebhook(false);
    webhooks.handleCancelEdit();
  };

  const handleFormSubmit = isEditMode ? webhooks.handleUpdate : webhooks.handleCreate;

  // Get the webhook being viewed for logs
  const viewingLogsWebhook = webhooks.viewingLogsId
    ? webhooks.webhooks.find((w) => w.id === webhooks.viewingLogsId)
    : null;

  if (webhooks.isLoading) {
    return (
      <div className="page">
        <div className="loading">{t.settings.loading}</div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1 data-testid="page-title">{t.settings.title}</h1>
        <p className="subtitle">{t.settings.subtitle}</p>
      </header>

      <section className="settings-section" data-testid="github-section">
        <GitHubConnection />
      </section>

      <ExportSection />

      <section className="settings-section" data-testid="webhooks-section">
        <div className="settings-section-header">
          <div>
            <h2>{t.settings.webhooks.title}</h2>
            <p className="settings-description">
              {webhooks.webhooks.length === 0 ? t.settings.webhooks.empty : ""}
            </p>
          </div>
          {!isFormVisible && (
            <button className="btn btn-primary" onClick={() => setShowAddWebhook(true)}>
              {t.settings.webhooks.actions.addWebhook}
            </button>
          )}
        </div>

        {isFormVisible && (
          <WebhookForm
            initialData={webhooks.editingWebhookData ?? webhooks.initialWebhook}
            isSubmitting={webhooks.isSubmitting}
            isEditMode={isEditMode}
            onSubmit={handleFormSubmit}
            onCancel={handleCancelForm}
          />
        )}

        <WebhookList
          webhooks={webhooks.webhooks}
          testingId={webhooks.testingId}
          onTest={webhooks.handleTest}
          onToggle={webhooks.handleToggle}
          onEdit={webhooks.handleEdit}
          onDelete={webhooks.openDeleteConfirm}
          onViewLogs={webhooks.handleViewLogs}
        />
      </section>

      <ConfirmDialog
        isOpen={webhooks.deleteConfirm.isOpen}
        title={t.settings.webhooks.confirm.deleteTitle}
        message={t.settings.webhooks.confirm.deleteMessage}
        confirmText={t.common.delete}
        variant="danger"
        onConfirm={webhooks.confirmDelete}
        onCancel={webhooks.closeDeleteConfirm}
      />

      {viewingLogsWebhook && (
        <WebhookLogsModal
          webhookName={viewingLogsWebhook.name}
          logs={webhooks.webhookLogs}
          isLoading={webhooks.isLoadingLogs}
          onClose={webhooks.handleCloseLogs}
        />
      )}

      <ToastContainer toasts={toast.toasts} onDismiss={toast.dismissToast} />
    </div>
  );
}
