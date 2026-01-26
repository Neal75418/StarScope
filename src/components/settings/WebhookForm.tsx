/**
 * Webhook creation/edit form component.
 */

import { useState, useEffect, FormEvent } from "react";
import { WebhookCreate, WebhookType, WebhookTrigger, getWebhookTypes, WebhookTypesResponse } from "../../api/client";
import { useI18n } from "../../i18n";

interface WebhookFormProps {
  initialData: WebhookCreate;
  isSubmitting: boolean;
  isEditMode?: boolean;
  onSubmit: (webhook: WebhookCreate) => Promise<boolean>;
  onCancel: () => void;
}

// Fallback options in case API call fails
const FALLBACK_TYPES: { id: WebhookType; name: string }[] = [
  { id: "slack", name: "Slack" },
  { id: "discord", name: "Discord" },
  { id: "generic", name: "Generic HTTP" },
];

const FALLBACK_TRIGGERS: { id: WebhookTrigger; name: string }[] = [
  { id: "signal_detected", name: "New Signal Detected" },
  { id: "daily_digest", name: "Daily Digest" },
  { id: "weekly_digest", name: "Weekly Digest" },
  { id: "threshold_alert", name: "Alert Fired" },
];

export function WebhookForm({ initialData, isSubmitting, isEditMode = false, onSubmit, onCancel }: WebhookFormProps) {
  const { t } = useI18n();
  const [webhook, setWebhook] = useState<WebhookCreate>(initialData);
  const [typesData, setTypesData] = useState<WebhookTypesResponse | null>(null);

  // Fetch available types and triggers on mount
  useEffect(() => {
    getWebhookTypes()
      .then(setTypesData)
      .catch((err) => console.error("Failed to fetch webhook types:", err));
  }, []);

  // Reset form when initialData changes (for edit mode)
  useEffect(() => {
    setWebhook(initialData);
  }, [initialData]);

  // Use API data if available, otherwise fallback to static options
  const webhookTypes = typesData?.types ?? FALLBACK_TYPES;
  const triggerOptions = typesData?.triggers ?? FALLBACK_TRIGGERS;

  const triggerLabels: Record<WebhookTrigger, string> = {
    signal_detected: t.settings.webhooks.triggers.new_signal,
    daily_digest: t.settings.webhooks.triggers.daily_digest,
    weekly_digest: t.settings.webhooks.triggers.weekly_digest,
    threshold_alert: t.settings.webhooks.triggers.alert_fired,
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!webhook.name || !webhook.url) return;

    const success = await onSubmit(webhook);
    if (success) {
      setWebhook(initialData);
      onCancel();
    }
  };

  const handleTriggerChange = (trigger: WebhookTrigger) => {
    const triggers = webhook.triggers.includes(trigger)
      ? webhook.triggers.filter((t) => t !== trigger)
      : [...webhook.triggers, trigger];
    setWebhook({ ...webhook, triggers });
  };

  return (
    <form className="webhook-form" onSubmit={handleSubmit}>
      <div className="form-row">
        <div className="form-group">
          <label>{t.settings.webhooks.form.name}</label>
          <input
            type="text"
            value={webhook.name}
            onChange={(e) => setWebhook({ ...webhook, name: e.target.value })}
            placeholder={t.settings.webhooks.form.namePlaceholder}
            required
          />
        </div>
        <div className="form-group">
          <label>{t.settings.webhooks.form.type}</label>
          <select
            value={webhook.webhook_type}
            onChange={(e) => setWebhook({ ...webhook, webhook_type: e.target.value as WebhookType })}
          >
            {webhookTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {t.settings.webhooks.types[type.id as keyof typeof t.settings.webhooks.types] ?? type.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-group">
        <label>{t.settings.webhooks.form.url}</label>
        <input
          type="url"
          value={webhook.url}
          onChange={(e) => setWebhook({ ...webhook, url: e.target.value })}
          placeholder={t.settings.webhooks.form.urlPlaceholder}
          required
        />
      </div>

      <div className="form-group">
        <label>{t.settings.webhooks.form.triggers}</label>
        <div className="trigger-options">
          {triggerOptions.map((trigger) => (
            <label key={trigger.id} className="trigger-option">
              <input
                type="checkbox"
                checked={webhook.triggers.includes(trigger.id as WebhookTrigger)}
                onChange={() => handleTriggerChange(trigger.id as WebhookTrigger)}
              />
              {triggerLabels[trigger.id as WebhookTrigger] ?? trigger.name}
            </label>
          ))}
        </div>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
          {isSubmitting
            ? (isEditMode ? t.settings.webhooks.actions.saving : t.settings.webhooks.actions.creating)
            : (isEditMode ? t.settings.webhooks.actions.saveWebhook : t.settings.webhooks.actions.createWebhook)}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {t.common.cancel}
        </button>
      </div>
    </form>
  );
}
