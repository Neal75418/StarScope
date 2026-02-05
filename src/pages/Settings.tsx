/**
 * Settings page - export data and manage alerts.
 */

import { useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ToastContainer, useToast } from "../components/Toast";
import { GitHubConnection } from "../components/GitHubConnection";
import { AnimatedPage } from "../components/motion";
import { ExportSection, ImportSection, AlertRuleForm, AlertRuleList } from "../components/settings";
import { useAlertRules } from "../hooks/useAlertRules";
import { useI18n } from "../i18n";

export function Settings() {
  const { t } = useI18n();
  const toast = useToast();
  const [showAddAlert, setShowAddAlert] = useState(false);
  const alerts = useAlertRules(toast);

  // Alert form state
  const isAlertFormVisible = showAddAlert || alerts.editingRule !== null;
  const isAlertEditMode = alerts.editingRule !== null;

  const handleCancelAlertForm = () => {
    setShowAddAlert(false);
    alerts.handleCancelEdit();
  };

  const handleAlertFormSubmit = isAlertEditMode ? alerts.handleUpdate : alerts.handleCreate;

  if (alerts.isLoading) {
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
          <div className="settings-section-actions">
            {!isAlertFormVisible && (
              <>
                <button
                  className="btn"
                  onClick={() => void alerts.handleCheckNow()}
                  disabled={alerts.isSubmitting}
                  title={t.settings.alerts.checkNow ?? "Check alerts now"}
                >
                  {t.settings.alerts.checkNow ?? "Check Now"}
                </button>
                <button className="btn btn-primary" onClick={() => setShowAddAlert(true)}>
                  {t.settings.alerts.create}
                </button>
              </>
            )}
          </div>
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

      <ConfirmDialog
        isOpen={alerts.deleteConfirm.isOpen}
        title={t.settings.alerts.confirm.deleteTitle}
        message={t.settings.alerts.confirm.deleteMessage}
        confirmText={t.common.delete}
        variant="danger"
        onConfirm={alerts.confirmDelete}
        onCancel={alerts.closeDeleteConfirm}
      />

      <ToastContainer toasts={toast.toasts} onDismiss={toast.dismissToast} />
    </AnimatedPage>
  );
}
