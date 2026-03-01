/**
 * 設定頁面，匯出資料與管理警示規則。
 */

import { useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ToastContainer, useToast } from "../components/Toast";
import { GitHubConnection } from "../components/GitHubConnection";
import { AnimatedPage } from "../components/motion";
import { ExportSection, ImportSection, AlertRuleForm, AlertRuleList } from "../components/settings";
import { useAlertRules } from "../hooks/useAlertRules";
import { useNotifications } from "../hooks/useNotifications";
import { useI18n } from "../i18n";

export function Settings() {
  const { t } = useI18n();
  const toast = useToast();
  const [showAddAlert, setShowAddAlert] = useState(false);
  const alerts = useAlertRules(toast);
  const { osNotification } = useNotifications();

  // 警示表單狀態
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

        {/* OS 通知設定 */}
        <div
          className="os-notification-settings"
          style={{
            marginBottom: "1rem",
            padding: "1rem",
            border: "1px solid var(--border)",
            borderRadius: "8px",
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "1rem" }}>🔔 系統通知</h3>
          <p style={{ marginBottom: "1rem", color: "var(--text-secondary)", fontSize: "0.875rem" }}>
            {osNotification.isGranted
              ? "已啟用 OS 層級通知，新的警示會顯示在系統通知中心"
              : "啟用後可在系統通知中心接收警示"}
          </p>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            {osNotification.isLoading ? (
              <span style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>
                檢查中...
              </span>
            ) : osNotification.isGranted ? (
              <span style={{ fontSize: "0.875rem", color: "var(--success)" }}>✓ 已啟用</span>
            ) : (
              <button
                className="btn btn-sm"
                onClick={() => void osNotification.requestPermission()}
              >
                啟用系統通知
              </button>
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
