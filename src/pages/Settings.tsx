/**
 * 設定頁面，管理外觀、資料、排程、警示規則等設定。
 */

import { useState, useEffect, useCallback } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import { GitHubConnection } from "../components/GitHubConnection";
import { LoadError } from "../components/LoadError";
import { AnimatedPage } from "../components/motion";
import {
  ImportSection,
  StarSyncSection,
  ArchivedRepos,
  AlertRuleForm,
  AlertRuleList,
  DataManagementSection,
  AboutSection,
  ScheduledRefreshSection,
  SnapshotRetentionSection,
  SignalThresholdsSection,
  InterestsSection,
} from "../components/settings";
import { DiagnosticsSection } from "../components/settings/DiagnosticsSection";
import { useAlertRules } from "../hooks/useAlertRules";
import { useOSNotification } from "../hooks/useOSNotification";
import { useI18n } from "../i18n";

export function Settings() {
  const { t } = useI18n();
  const toast = useToast();
  const [showAddAlert, setShowAddAlert] = useState(false);
  const alerts = useAlertRules(toast);
  const osNotification = useOSNotification();

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

  // 追蹤可見 section 以高亮 nav（需要 IntersectionObserver 支援）
  const [activeSection, setActiveSection] = useState<string>("github");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    const sectionIds = [
      "github",
      "scheduled-refresh",
      "snapshot-retention",
      "signal-thresholds",
      "interests",
      "import",
      "data-management",
      "alerts",
      "diagnostics",
      "about",
    ];
    const observers: IntersectionObserver[] = [];
    for (const id of sectionIds) {
      const el = document.getElementById(id);
      if (!el) continue;
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setActiveSection(id);
        },
        { rootMargin: "-20% 0px -60% 0px" }
      );
      observer.observe(el);
      observers.push(observer);
    }
    return () => observers.forEach((o) => o.disconnect());
  }, []);

  const scrollToSection = useCallback((id: string) => {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(id)?.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth" });
  }, []);

  const navItems = [
    { id: "github", label: t.githubConnection.title },
    { id: "star-sync", label: t.settings.starSync.title },
    { id: "archived", label: t.settings.archived.title },
    { id: "scheduled-refresh", label: t.settings.scheduledRefresh.title },
    { id: "snapshot-retention", label: t.settings.snapshotRetention.title },
    { id: "signal-thresholds", label: t.settings.signalThresholds.title },
    { id: "interests", label: t.settings.interests.title },
    { id: "import", label: t.settings.import.title },
    { id: "data-management", label: t.settings.data.title },
    { id: "alerts", label: t.settings.alerts.title },
    { id: "diagnostics", label: t.settings.diagnostics.title },
    { id: "about", label: t.settings.about.title },
  ];

  return (
    <AnimatedPage className="page">
      <header className="page-header">
        <h1 data-testid="page-title">{t.settings.title}</h1>
        <p className="subtitle">{t.settings.subtitle}</p>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t.settings.title}>
          {navItems.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`settings-nav-item${activeSection === id ? " active" : ""}`}
              aria-current={activeSection === id ? "true" : undefined}
              onClick={() => scrollToSection(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {/* GitHub 連線 */}
          <section id="github" className="settings-section" data-testid="github-section">
            <GitHubConnection />
          </section>

          {/* Star 同步與封存：緊接 GitHub 連線，與「先連帳號再同步」的實際順序一致 */}
          <div id="star-sync">
            <StarSyncSection />
          </div>

          <div id="archived">
            <ArchivedRepos />
          </div>

          {/* 定時更新 */}
          <div id="scheduled-refresh">
            <ScheduledRefreshSection onToast={handleDataToast} />
          </div>

          {/* 快照保留期限 */}
          <div id="snapshot-retention">
            <SnapshotRetentionSection onToast={handleDataToast} />
          </div>

          {/* Early Signal 偵測門檻 */}
          <div id="signal-thresholds">
            <SignalThresholdsSection onToast={handleDataToast} />
          </div>

          {/* Feed 興趣清單 */}
          <div id="interests">
            <InterestsSection onToast={handleDataToast} />
          </div>

          {/* 匯入 */}
          <div id="import">
            <ImportSection />
          </div>

          {/* 資料管理 */}
          <div id="data-management">
            <DataManagementSection onToast={handleDataToast} />
          </div>

          {/* 警示規則 */}
          <section id="alerts" className="settings-section" data-testid="alerts-section">
            <div className="settings-section-header">
              <div>
                <h2>{t.settings.alerts.title}</h2>
              </div>
              <div className="settings-section-actions">
                {!isAlertFormVisible && (
                  <>
                    <button
                      className="btn"
                      onClick={() => void alerts.handleCheckNow()}
                      disabled={alerts.isSubmitting}
                      title={t.settings.alerts.checkNow}
                    >
                      {t.settings.alerts.checkNow}
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
                  <span className="os-notification-status">
                    {t.settings.osNotification.checking}
                  </span>
                ) : osNotification.isGranted ? (
                  <span className="os-notification-status enabled">
                    {`✓ ${t.settings.osNotification.enabled}`}
                  </span>
                ) : (
                  <button
                    className="btn btn-sm"
                    onClick={() => void osNotification.requestNotificationPermission()}
                  >
                    {t.settings.osNotification.enable}
                  </button>
                )}
              </div>
            </div>

            {/* 排在表單前面：表單的下拉選單（訊號類型、追蹤清單）靠的就是這份資料，讀不到時選單是空的 */}
            {alerts.dataLoad.failed && (
              <LoadError
                testId="alerts-load-error"
                message={t.settings.alerts.loadError}
                isRetrying={alerts.dataLoad.inProgress}
                onRetry={alerts.dataLoad.retry}
              />
            )}

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

            {/* 還沒讀到規則時只在這個區塊說「載入中」，不換掉整頁：警報資料只是其中一塊，整頁換掉的話
                其他區塊打到一半的字與捲動位置都會不見，重試時連「讀不到＋重試」也跟著消失 */}
            {!alerts.rulesLoad.ready && !alerts.rulesLoad.failed && (
              <p className="settings-hint">{t.settings.loading}</p>
            )}

            {/* 清單是空的時候 AlertRuleList 會說「尚未設定警報規則」：只有讀到了、而且真的沒有才能這樣說。
                重讀失敗時上一次讀到的規則照樣列出 */}
            {(alerts.rules.length > 0 || (alerts.rulesLoad.ready && !alerts.rulesLoad.failed)) && (
              <AlertRuleList
                rules={alerts.rules}
                onToggle={alerts.handleToggle}
                onEdit={alerts.handleEdit}
                onDelete={alerts.openDeleteConfirm}
              />
            )}
          </section>

          {/* 系統診斷 */}
          <DiagnosticsSection />

          {/* 關於 */}
          <div id="about">
            <AboutSection />
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={alerts.deleteConfirm.isOpen}
        title={t.settings.alerts.confirm.deleteTitle}
        message={t.settings.alerts.confirm.deleteMessage}
        confirmText={t.common.delete}
        variant="danger"
        isProcessing={alerts.isSubmitting}
        onConfirm={alerts.confirmDelete}
        onCancel={alerts.closeDeleteConfirm}
      />
    </AnimatedPage>
  );
}
