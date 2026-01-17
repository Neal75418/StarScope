/**
 * Settings page - export data and manage webhooks.
 */

import { useState, useEffect } from "react";
import {
  Webhook,
  WebhookCreate,
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

export function Settings() {
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
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; webhookId: number | null }>({
    isOpen: false,
    webhookId: null,
  });
  const toast = useToast();

  const loadWebhooks = async () => {
    try {
      const response = await listWebhooks();
      setWebhooks(response.webhooks);
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to load webhooks"));
    }
  };

  useEffect(() => {
    setIsLoading(true);
    loadWebhooks().finally(() => setIsLoading(false));
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
      toast.success("Webhook created successfully");
      loadWebhooks();
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to create webhook"));
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
      toast.success("Webhook deleted");
      loadWebhooks();
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to delete webhook"));
    } finally {
      setDeleteConfirm({ isOpen: false, webhookId: null });
    }
  };

  const handleTestWebhook = async (id: number) => {
    setTestingId(id);
    try {
      const result = await testWebhook(id);
      if (result.success) {
        toast.success("Test message sent successfully!");
      } else {
        toast.error("Failed to send test message");
      }
      loadWebhooks();
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to send test message"));
    } finally {
      setTestingId(null);
    }
  };

  const handleToggleWebhook = async (id: number) => {
    try {
      await toggleWebhook(id);
      loadWebhooks();
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to toggle webhook"));
    }
  };

  const handleTriggerChange = (trigger: string) => {
    const triggers = newWebhook.triggers.includes(trigger as any)
      ? newWebhook.triggers.filter((t) => t !== trigger)
      : [...newWebhook.triggers, trigger as any];
    setNewWebhook({ ...newWebhook, triggers });
  };

  if (isLoading) {
    return (
      <div className="page">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Settings</h1>
        <p className="subtitle">Manage connections, export data, and configure notifications</p>
      </header>

      {/* GitHub Connection Section */}
      <section className="settings-section">
        <GitHubConnection />
      </section>

      {/* Export Section */}
      <section className="settings-section">
        <h2>Export Data</h2>
        <p className="settings-description">
          Download your data in various formats for backup or analysis.
        </p>

        <div className="export-grid">
          <div className="export-card">
            <h3>Watchlist</h3>
            <p>Export all tracked repositories with their current stats.</p>
            <div className="export-actions">
              <a
                href={getExportWatchlistUrl("json")}
                className="btn btn-sm"
                download
              >
                JSON
              </a>
              <a
                href={getExportWatchlistUrl("csv")}
                className="btn btn-sm"
                download
              >
                CSV
              </a>
            </div>
          </div>

          <div className="export-card">
            <h3>Signals</h3>
            <p>Export all detected early signals.</p>
            <div className="export-actions">
              <a
                href={getExportSignalsUrl("json")}
                className="btn btn-sm"
                download
              >
                JSON
              </a>
              <a
                href={getExportSignalsUrl("csv")}
                className="btn btn-sm"
                download
              >
                CSV
              </a>
            </div>
          </div>

          <div className="export-card">
            <h3>Full Report</h3>
            <p>Complete data export including all repos and signals.</p>
            <div className="export-actions">
              <a
                href={getExportFullReportUrl()}
                className="btn btn-sm btn-primary"
                download
              >
                Download JSON
              </a>
            </div>
          </div>

          <div className="export-card">
            <h3>Weekly Digest</h3>
            <p>Summary report of the past week's activity.</p>
            <div className="export-actions">
              <a
                href={getDigestUrl("weekly", "html")}
                className="btn btn-sm"
                target="_blank"
              >
                HTML
              </a>
              <a
                href={getDigestUrl("weekly", "md")}
                className="btn btn-sm"
                download
              >
                Markdown
              </a>
              <a
                href={getDigestUrl("weekly", "json")}
                className="btn btn-sm"
                download
              >
                JSON
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Webhooks Section */}
      <section className="settings-section">
        <div className="settings-section-header">
          <div>
            <h2>Webhooks</h2>
            <p className="settings-description">
              Configure notifications to Slack, Discord, or custom endpoints.
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setShowAddWebhook(!showAddWebhook)}
          >
            {showAddWebhook ? "Cancel" : "+ Add Webhook"}
          </button>
        </div>

        {showAddWebhook && (
          <form className="webhook-form" onSubmit={handleCreateWebhook}>
            <div className="form-row">
              <div className="form-group">
                <label>Name</label>
                <input
                  type="text"
                  value={newWebhook.name}
                  onChange={(e) =>
                    setNewWebhook({ ...newWebhook, name: e.target.value })
                  }
                  placeholder="My Slack Webhook"
                  required
                />
              </div>
              <div className="form-group">
                <label>Type</label>
                <select
                  value={newWebhook.webhook_type}
                  onChange={(e) =>
                    setNewWebhook({
                      ...newWebhook,
                      webhook_type: e.target.value as any,
                    })
                  }
                >
                  <option value="slack">Slack</option>
                  <option value="discord">Discord</option>
                  <option value="generic">Generic HTTP</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Webhook URL</label>
              <input
                type="url"
                value={newWebhook.url}
                onChange={(e) =>
                  setNewWebhook({ ...newWebhook, url: e.target.value })
                }
                placeholder="https://hooks.slack.com/services/..."
                required
              />
            </div>

            <div className="form-group">
              <label>Triggers</label>
              <div className="trigger-options">
                {[
                  { id: "signal_detected", label: "New Signal Detected" },
                  { id: "daily_digest", label: "Daily Digest" },
                  { id: "weekly_digest", label: "Weekly Digest" },
                ].map((trigger) => (
                  <label key={trigger.id} className="trigger-option">
                    <input
                      type="checkbox"
                      checked={newWebhook.triggers.includes(trigger.id as any)}
                      onChange={() => handleTriggerChange(trigger.id)}
                    />
                    {trigger.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isCreating}
              >
                {isCreating ? "Creating..." : "Create Webhook"}
              </button>
            </div>
          </form>
        )}

        <div className="webhook-list">
          {webhooks.length === 0 ? (
            <div className="webhook-empty">
              No webhooks configured yet. Add one to receive notifications.
            </div>
          ) : (
            webhooks.map((webhook) => (
              <div key={webhook.id} className="webhook-card">
                <div className="webhook-info">
                  <div className="webhook-header">
                    <span className="webhook-name">{webhook.name}</span>
                    <span className={`webhook-type ${webhook.webhook_type}`}>
                      {webhook.webhook_type}
                    </span>
                    <span
                      className={`webhook-status ${
                        webhook.enabled ? "enabled" : "disabled"
                      }`}
                    >
                      {webhook.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <div className="webhook-url">{webhook.url}</div>
                  <div className="webhook-triggers">
                    Triggers: {webhook.triggers.join(", ").replace(/_/g, " ")}
                  </div>
                  {webhook.last_error && (
                    <div className="webhook-error">
                      Last error: {webhook.last_error}
                    </div>
                  )}
                </div>
                <div className="webhook-actions">
                  <button
                    className="btn btn-sm"
                    onClick={() => handleTestWebhook(webhook.id)}
                    disabled={testingId === webhook.id}
                  >
                    {testingId === webhook.id ? "Testing..." : "Test"}
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => handleToggleWebhook(webhook.id)}
                  >
                    {webhook.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => handleDeleteWebhook(webhook.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        title="Delete Webhook"
        message="Are you sure you want to delete this webhook? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
        onConfirm={confirmDeleteWebhook}
        onCancel={() => setDeleteConfirm({ isOpen: false, webhookId: null })}
      />

      <ToastContainer toasts={toast.toasts} onDismiss={toast.dismissToast} />
    </div>
  );
}
