/**
 * 設定頁面，管理外觀、資料、排程、警示規則等設定。
 */

import { useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ToastContainer, useToast } from "../components/Toast";
import { GitHubConnection } from "../components/GitHubConnection";
import { AnimatedPage } from "../components/motion";
import {
  ExportSection,
  ImportSection,
  AlertRuleForm,
  AlertRuleList,
  AppearanceSection,
  DataManagementSection,
  AboutSection,
  ScheduledRefreshSection,
  SnapshotRetentionSection,
  SignalThresholdsSection,
  KeyboardShortcutsSection,
} from "../components/settings";
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

  // DataManagementSection 的 toast 介接
  const handleDataToast = (message: string, type?: "success" | "error") => {
    if (type === "error") {
      toast.error(message);
    } else {
      toast.success(message);
    }
  };

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

      {/* 外觀設定 */}
      <AppearanceSection />

      {/* GitHub 連線 */}
      <section className="settings-section" data-testid="github-section">
        <GitHubConnection />
      </section>

      {/* 定時更新 */}
      <ScheduledRefreshSection onToast={handleDataToast} />

      {/* 快照保留期限 */}
      <SnapshotRetentionSection onToast={handleDataToast} />

      {/* Early Signal 偵測門檻 */}
      <SignalThresholdsSection onToast={handleDataToast} />

      <ExportSection />

      <ImportSection />

      {/* 資料管理 */}
      <DataManagementSection onToast={handleDataToast} />

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
        <div className="os-notification-settings">
          <h3>{t.settings.osNotification.title}</h3>
          <p className="os-notification-desc">
            {osNotification.isGranted
              ? t.settings.osNotification.enabledDesc
              : t.settings.osNotification.disabledDesc}
          </p>
          <div className="os-notification-actions">
            {osNotification.isLoading ? (
              <span className="os-notification-status">{t.settings.osNotification.checking}</span>
            ) : osNotification.isGranted ? (
              <span className="os-notification-status enabled">
                {`✓ ${t.settings.osNotification.enabled}`}
              </span>
            ) : (
              <button
                className="btn btn-sm"
                onClick={() => void osNotification.requestPermission()}
              >
                {t.settings.osNotification.enable}
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

      {/* 鍵盤快捷鍵 */}
      <KeyboardShortcutsSection />

      {/* 關於 */}
      <AboutSection />

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
