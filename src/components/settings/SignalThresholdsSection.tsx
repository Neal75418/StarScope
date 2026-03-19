/**
 * Early Signal 偵測門檻設定區塊。
 * 讓使用者調整偵測靈敏度，並可重置為預設值。
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "../../i18n";
import { getSignalThresholds, updateSignalThresholds } from "../../api/client";
import type { SignalThresholdsResponse } from "../../api/types";
import { Skeleton } from "../Skeleton";

const DEFAULTS: SignalThresholdsResponse = {
  rising_star_min_velocity: 10,
  sudden_spike_multiplier: 3,
  breakout_velocity_threshold: 2,
  viral_hn_min_score: 100,
};

interface SignalThresholdsSectionProps {
  onToast: (message: string, type?: "success" | "error") => void;
}

type ThresholdKey = keyof SignalThresholdsResponse;

export function SignalThresholdsSection({ onToast }: SignalThresholdsSectionProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["settings", "signalThresholds"],
    queryFn: ({ signal }) => getSignalThresholds(signal),
  });

  const current = data ?? DEFAULTS;
  const [draft, setDraft] = useState<Partial<Record<ThresholdKey, string>>>({});

  const mutation = useMutation({
    mutationFn: (updates: Partial<SignalThresholdsResponse>) => updateSignalThresholds(updates),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings", "signalThresholds"] });
      setDraft({});
      onToast(t.settings.signalThresholds.toast.saved, "success");
    },
    onError: () => {
      onToast(t.settings.signalThresholds.toast.error, "error");
    },
  });

  const handleReset = () => {
    mutation.mutate(DEFAULTS, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ["settings", "signalThresholds"] });
        setDraft({});
        onToast(t.settings.signalThresholds.toast.reset, "success");
      },
    });
  };

  const handleSave = () => {
    const updates: Partial<SignalThresholdsResponse> = {};
    for (const [key, val] of Object.entries(draft)) {
      const parsed = parseFloat(val);
      if (!isNaN(parsed)) {
        (updates as Record<string, number>)[key] = parsed;
      }
    }
    if (Object.keys(updates).length > 0) {
      mutation.mutate(updates);
    }
  };

  const getValue = (key: ThresholdKey): string => {
    if (draft[key] !== undefined) return draft[key]!;
    return String(current[key]);
  };

  const setDraftKey = (key: ThresholdKey, val: string) => {
    setDraft((prev) => ({ ...prev, [key]: val }));
  };

  const hasDraft = Object.keys(draft).length > 0;

  const fields: { key: ThresholdKey; label: string; step: string }[] = [
    { key: "rising_star_min_velocity", label: t.settings.signalThresholds.risingStar, step: "1" },
    { key: "sudden_spike_multiplier", label: t.settings.signalThresholds.suddenSpike, step: "0.5" },
    {
      key: "breakout_velocity_threshold",
      label: t.settings.signalThresholds.breakout,
      step: "0.5",
    },
    { key: "viral_hn_min_score", label: t.settings.signalThresholds.viralHn, step: "10" },
  ];

  return (
    <section className="settings-section" data-testid="signal-thresholds-section">
      <h2>{t.settings.signalThresholds.title}</h2>
      <p className="settings-description">{t.settings.signalThresholds.description}</p>

      {isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} width="100%" height={40} variant="rounded" />
          ))}
        </div>
      ) : (
        <>
          <div className="signal-thresholds-grid">
            {fields.map(({ key, label, step }) => (
              <div key={key} className="settings-field">
                <label className="settings-field-label" htmlFor={`threshold-${key}`}>
                  {label}
                </label>
                <input
                  id={`threshold-${key}`}
                  type="number"
                  className="settings-number-input"
                  step={step}
                  min={0}
                  value={getValue(key)}
                  onChange={(e) => setDraftKey(key, e.target.value)}
                />
              </div>
            ))}
          </div>

          <div className="settings-actions-row">
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={mutation.isPending || !hasDraft}
            >
              {mutation.isPending ? `${t.common.save}...` : t.common.save}
            </button>
            <button className="btn" onClick={handleReset} disabled={mutation.isPending}>
              {t.settings.signalThresholds.reset}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
