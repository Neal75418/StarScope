/**
 * Settings page - export data, manage alerts and webhooks.
 */

import { useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ToastContainer, useToast } from "../components/Toast";
import { GitHubConnection } from "../components/GitHubConnection";
import { AnimatedPage } from "../components/motion";
import {
  ExportSection,
  ImportSection,
  WebhookForm,
  WebhookList,
  WebhookLogsModal,
  AlertRuleForm,
  AlertRuleList,
} from "../components/settings";
import { useWebhooks } from "../hooks/useWebhooks";
import { useAlertRules } from "../hooks/useAlertRules";
import { useI18n } from "../i18n";

export function Settings() {
  const { t } = useI18n();
  const toast = useToast();
  const [showAddWebhook, setShowAddWebhook] = useState(false);
  const [showAddAlert, setShowAddAlert] = useState(false);
  const webhooks = useWebhooks(toast);
  const alerts = useAlertRules(toast);

  // Webhook form state
  const isWebhookFormVisible = showAddWebhook || webhooks.editingWebhook !== null;
  const isWebhookEditMode = webhooks.editingWebhook !== null;

  // Alert form state
  const isAlertFormVisible = showAddAlert || alerts.editingRule !== null;
  const isAlertEditMode = alerts.editingRule !== null;

  // Legacy names for compatibility
  const isFormVisible = isWebhookFormVisible;
  const isEditMode = isWebhookEditMode;

  const handleCancelWebhookForm = () => {
    setShowAddWebhook(false);
    webhooks.handleCancelEdit();
  };

  const handleCancelAlertForm = () => {
    setShowAddAlert(false);
    alerts.handleCancelEdit();
  };

  const handleWebhookFormSubmit = isWebhookEditMode ? webhooks.handleUpdate : webhooks.handleCreate;
  const handleAlertFormSubmit = isAlertEditMode ? alerts.handleUpdate : alerts.handleCreate;

  // Legacy names
  const handleCancelForm = handleCancelWebhookForm;
  const handleFormSubmit = handleWebhookFormSubmit;

  // Get the webhook being viewed for logs
  const viewingLogsWebhook = webhooks.viewingLogsId
    ? webhooks.webhooks.find((w) => w.id === webhooks.viewingLogsId)
    : null;

  if (webhooks.isLoading || alerts.isLoading) {
    return (
      <div className="page">
        <div className="loading">{t.settings.loading}</div>
      </div>
    );
  }

  return (
    <AnimatedPage className="page">
      <header className="page-header">
        <h1 data-testid="page-title">{t.settings.title}</h1>
        <p className="subtitle">{t.settings.subtitle}</p>
      </header>

      <section className="settings-section" data-testid="github-section">
        <GitHubConnection />
      </section>

      <ExportSection />

      <ImportSection />

      <section className="settings-section" data-testid="alerts-section">
        <div className="settings-section-header">
          <div>
            <h2>{t.settings.alerts.title}</h2>
            <p className="settings-description">
              {alerts.rules.length === 0 ? t.settings.alerts.noAlerts : ""}
            </p>
          </div>
          {!isAlertFormVisible && (
            <button className="btn btn-primary" onClick={() => setShowAddAlert(true)}>
              {t.settings.alerts.create}
            </button>
          )}
        </div>

        {isAlertFormVisible && (
          <AlertRuleForm
            initialData={alerts.editingRuleData ?? alerts.initialAlertRule}
            signalTypes={alerts.signalTypes}
            repos={alerts.repos}
            isSubmitting={alerts.isSubmitting}
            isEditMode={isAlertEditMode}
            onSubmit={handleAlertFormSubmit}
            onCancel={handleCancelAlertForm}
          />
        )}

        <AlertRuleList
          rules={alerts.rules}
          onToggle={alerts.handleToggle}
          onEdit={alerts.handleEdit}
          onDelete={alerts.openDeleteConfirm}
        />
      </section>

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

      <ConfirmDialog
        isOpen={alerts.deleteConfirm.isOpen}
        title={t.settings.alerts.confirm.deleteTitle}
        message={t.settings.alerts.confirm.deleteMessage}
        confirmText={t.common.delete}
        variant="danger"
        onConfirm={alerts.confirmDelete}
        onCancel={alerts.closeDeleteConfirm}
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
    </AnimatedPage>
  );
}
