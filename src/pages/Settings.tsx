/**
 * Settings page - export data and manage webhooks.
 */

import { useState, useEffect } from "react";
import {
  Webhook,
  WebhookCreate,
  WebhookType,
  WebhookTrigger,
  listWebhooks,
  createWebhook,
  deleteWebhook,
  testWebhook,
  toggleWebhook,
  getExportWatchlistUrl,
  getExportSignalsUrl,
  getExportFullReportUrl,
  getDigestUrl,
} from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ToastContainer, useToast } from "../components/Toast";
import { GitHubConnection } from "../components/GitHubConnection";
import { getErrorMessage } from "../utils/error";
import { useI18n } from "../i18n";

export function Settings() {
  const { t } = useI18n();
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [showAddWebhook, setShowAddWebhook] = useState(false);
  const [newWebhook, setNewWebhook] = useState<WebhookCreate>({
    name: "",
    webhook_type: "slack",
    url: "",
    triggers: ["signal_detected"],
  });
  const [testingId, setTestingId] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; webhookId: number | null }>(
    {
      isOpen: false,
      webhookId: null,
    }
  );
  const toast = useToast();

  const loadWebhooks = async () => {
    try {
      const response = await listWebhooks();
      setWebhooks(response.webhooks);
    } catch (err) {
      toast.error(getErrorMessage(err, t.settings.webhooks.toast.testFailed));
    }
  };

  useEffect(() => {
    setIsLoading(true);
    loadWebhooks().finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWebhook.name || !newWebhook.url) return;

    setIsCreating(true);
    try {
      await createWebhook(newWebhook);
      setNewWebhook({
        name: "",
        webhook_type: "slack",
        url: "",
        triggers: ["signal_detected"],
      });
      setShowAddWebhook(false);
      toast.success(t.settings.webhooks.toast.created);
      loadWebhooks();
    } catch (err) {
      toast.error(getErrorMessage(err, t.settings.webhooks.toast.testFailed));
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteWebhook = (id: number) => {
    setDeleteConfirm({ isOpen: true, webhookId: id });
  };

  const confirmDeleteWebhook = async () => {
    if (!deleteConfirm.webhookId) return;

    try {
      await deleteWebhook(deleteConfirm.webhookId);
      toast.success(t.settings.webhooks.toast.deleted);
      loadWebhooks();
    } catch (err) {
      toast.error(getErrorMessage(err, t.settings.webhooks.toast.testFailed));
    } finally {
      setDeleteConfirm({ isOpen: false, webhookId: null });
    }
  };

  const handleTestWebhook = async (id: number) => {
    setTestingId(id);
    try {
      const result = await testWebhook(id);
      if (result.success) {
        toast.success(t.settings.webhooks.toast.testSent);
      } else {
        toast.error(t.settings.webhooks.toast.testFailed);
      }
      loadWebhooks();
    } catch (err) {
      toast.error(getErrorMessage(err, t.settings.webhooks.toast.testFailed));
    } finally {
      setTestingId(null);
    }
  };

  const handleToggleWebhook = async (id: number) => {
    try {
      await toggleWebhook(id);
      loadWebhooks();
    } catch (err) {
      toast.error(getErrorMessage(err, t.settings.webhooks.toast.testFailed));
    }
  };

  const handleTriggerChange = (trigger: string) => {
    const typedTrigger = trigger as WebhookTrigger;
    const triggers = newWebhook.triggers.includes(typedTrigger)
      ? newWebhook.triggers.filter((t) => t !== trigger)
      : [...newWebhook.triggers, typedTrigger];
    setNewWebhook({ ...newWebhook, triggers });
  };

  if (isLoading) {
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

      {/* GitHub Connection Section */}
      <section className="settings-section" data-testid="github-section">
        <GitHubConnection />
      </section>

      {/* Export Section */}
      <section className="settings-section" data-testid="export-section">
        <h2>{t.settings.export.title}</h2>
        <p className="settings-description">{t.settings.export.subtitle}</p>

        <div className="export-grid">
          <div className="export-card">
            <h3>{t.settings.export.cards.watchlist.title}</h3>
            <p>{t.settings.export.cards.watchlist.desc}</p>
            <div className="export-actions">
              <a href={getExportWatchlistUrl("json")} className="btn btn-sm" download>
                {t.settings.export.json}
              </a>
              <a href={getExportWatchlistUrl("csv")} className="btn btn-sm" download>
                {t.settings.export.csv}
              </a>
            </div>
          </div>

          <div className="export-card">
            <h3>{t.settings.export.cards.signals.title}</h3>
            <p>{t.settings.export.cards.signals.desc}</p>
            <div className="export-actions">
              <a href={getExportSignalsUrl("json")} className="btn btn-sm" download>
                {t.settings.export.json}
              </a>
              <a href={getExportSignalsUrl("csv")} className="btn btn-sm" download>
                {t.settings.export.csv}
              </a>
            </div>
          </div>

          <div className="export-card">
            <h3>{t.settings.export.cards.fullReport.title}</h3>
            <p>{t.settings.export.cards.fullReport.desc}</p>
            <div className="export-actions">
              <a href={getExportFullReportUrl()} className="btn btn-sm btn-primary" download>
                {t.settings.export.cards.fullReport.download}
              </a>
            </div>
          </div>

          <div className="export-card">
            <h3>{t.settings.export.cards.weeklyDigest.title}</h3>
            <p>{t.settings.export.cards.weeklyDigest.desc}</p>
            <div className="export-actions">
              <a href={getDigestUrl("weekly", "html")} className="btn btn-sm" target="_blank">
                {t.settings.export.html}
              </a>
              <a href={getDigestUrl("weekly", "md")} className="btn btn-sm" download>
                {t.settings.export.markdown}
              </a>
              <a href={getDigestUrl("weekly", "json")} className="btn btn-sm" download>
                {t.settings.export.json}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Webhooks Section */}
      <section className="settings-section" data-testid="webhooks-section">
        <div className="settings-section-header">
          <div>
            <h2>{t.settings.webhooks.title}</h2>
            <p className="settings-description">
              {t.settings.webhooks.noWebhooks ? t.settings.webhooks.empty : ""}
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowAddWebhook(!showAddWebhook)}>
            {showAddWebhook ? t.common.cancel : t.settings.webhooks.actions.addWebhook}
          </button>
        </div>

        {showAddWebhook && (
          <form className="webhook-form" onSubmit={handleCreateWebhook}>
            <div className="form-row">
              <div className="form-group">
                <label>{t.settings.webhooks.form.name}</label>
                <input
                  type="text"
                  value={newWebhook.name}
                  onChange={(e) => setNewWebhook({ ...newWebhook, name: e.target.value })}
                  placeholder={t.settings.webhooks.form.namePlaceholder}
                  required
                />
              </div>
              <div className="form-group">
                <label>{t.settings.webhooks.form.type}</label>
                <select
                  value={newWebhook.webhook_type}
                  onChange={(e) =>
                    setNewWebhook({
                      ...newWebhook,
                      webhook_type: e.target.value as WebhookType,
                    })
                  }
                >
                  <option value="slack">{t.settings.webhooks.types.slack}</option>
                  <option value="discord">{t.settings.webhooks.types.discord}</option>
                  <option value="generic">{t.settings.webhooks.types.generic}</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>{t.settings.webhooks.form.url}</label>
              <input
                type="url"
                value={newWebhook.url}
                onChange={(e) => setNewWebhook({ ...newWebhook, url: e.target.value })}
                placeholder={t.settings.webhooks.form.urlPlaceholder}
                required
              />
            </div>

            <div className="form-group">
              <label>{t.settings.webhooks.form.triggers}</label>
              <div className="trigger-options">
                {[
                  { id: "signal_detected", label: t.settings.webhooks.triggers.new_signal },
                  { id: "daily_digest", label: t.settings.webhooks.triggers.daily_digest },
                  { id: "weekly_digest", label: t.settings.webhooks.triggers.weekly_digest },
                ].map((trigger) => (
                  <label key={trigger.id} className="trigger-option">
                    <input
                      type="checkbox"
                      checked={newWebhook.triggers.includes(trigger.id as WebhookTrigger)}
                      onChange={() => handleTriggerChange(trigger.id)}
                    />
                    {trigger.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={isCreating}>
                {isCreating
                  ? t.settings.webhooks.actions.creating
                  : t.settings.webhooks.actions.createWebhook}
              </button>
            </div>
          </form>
        )}

        <div className="webhook-list">
          {webhooks.length === 0 ? (
            <div className="webhook-empty">{t.settings.webhooks.empty}</div>
          ) : (
            webhooks.map((webhook) => (
              <div key={webhook.id} className="webhook-card">
                <div className="webhook-info">
                  <div className="webhook-header">
                    <span className="webhook-name">{webhook.name}</span>
                    <span className={`webhook-type ${webhook.webhook_type}`}>
                      {webhook.webhook_type}
                    </span>
                    <span className={`webhook-status ${webhook.enabled ? "enabled" : "disabled"}`}>
                      {webhook.enabled
                        ? t.settings.webhooks.status.enabled
                        : t.settings.webhooks.status.disabled}
                    </span>
                  </div>
                  <div className="webhook-url">{webhook.url}</div>
                  <div className="webhook-triggers">
                    {t.settings.webhooks.labels.triggers}:{" "}
                    {webhook.triggers.join(", ").replace(/_/g, " ")}
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
                    onClick={() => handleTestWebhook(webhook.id)}
                    disabled={testingId === webhook.id}
                  >
                    {testingId === webhook.id
                      ? t.settings.webhooks.actions.testing
                      : t.settings.webhooks.actions.test}
                  </button>
                  <button className="btn btn-sm" onClick={() => handleToggleWebhook(webhook.id)}>
                    {webhook.enabled
                      ? t.settings.webhooks.actions.disable
                      : t.settings.webhooks.actions.enable}
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => handleDeleteWebhook(webhook.id)}
                  >
                    {t.settings.webhooks.actions.delete}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        title={t.settings.webhooks.confirm.deleteTitle}
        message={t.settings.webhooks.confirm.deleteMessage}
        confirmText={t.common.delete}
        variant="danger"
        onConfirm={confirmDeleteWebhook}
        onCancel={() => setDeleteConfirm({ isOpen: false, webhookId: null })}
      />

      <ToastContainer toasts={toast.toasts} onDismiss={toast.dismissToast} />
    </div>
  );
}
