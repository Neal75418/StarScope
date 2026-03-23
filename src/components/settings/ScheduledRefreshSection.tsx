/**
 * 定時更新設定區塊。
 * 讓使用者設定 StarScope 從 GitHub 抓取資料的頻率。
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "../../i18n";
import { getFetchInterval, updateFetchInterval } from "../../api/client";
import { Skeleton } from "../Skeleton";

const ALLOWED_INTERVALS = [60, 360, 720, 1440] as const;
type FetchInterval = (typeof ALLOWED_INTERVALS)[number];

interface ScheduledRefreshSectionProps {
  onToast: (message: string, type?: "success" | "error") => void;
}

export function ScheduledRefreshSection({ onToast }: ScheduledRefreshSectionProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["settings", "fetchInterval"],
    queryFn: ({ signal }) => getFetchInterval(signal),
  });

  const currentInterval = (data?.interval_minutes ?? 60) as FetchInterval;
  const [selected, setSelected] = useState<FetchInterval | null>(null);
  const effectiveInterval = selected ?? currentInterval;

  const mutation = useMutation({
    mutationFn: (interval: FetchInterval) => updateFetchInterval(interval),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["settings", "fetchInterval"] });
      setSelected(null);
      onToast(t.settings.scheduledRefresh.toast.saved, "success");
      return result;
    },
    onError: () => {
      onToast(t.settings.scheduledRefresh.toast.error, "error");
    },
  });

  const handleSave = () => {
    if (selected !== null && selected !== currentInterval) {
      mutation.mutate(selected);
    }
  };

  const intervalKey = String(
    effectiveInterval
  ) as keyof typeof t.settings.scheduledRefresh.intervals;
  const intervalLabel =
    t.settings.scheduledRefresh.intervals[intervalKey] ?? `${effectiveInterval} min`;

  return (
    <section className="settings-section" data-testid="scheduled-refresh-section">
      <h2>{t.settings.scheduledRefresh.title}</h2>
      <p className="settings-description">{t.settings.scheduledRefresh.description}</p>

      {isLoading ? (
        <Skeleton width={300} height={40} variant="rounded" />
      ) : (
        <div className="settings-field">
          <label className="settings-field-label" htmlFor="scheduled-refresh-interval">
            {t.settings.scheduledRefresh.interval}
          </label>
          <div className="settings-interval-row">
            <select
              id="scheduled-refresh-interval"
              className="settings-select"
              value={effectiveInterval}
              onChange={(e) => setSelected(parseInt(e.target.value) as FetchInterval)}
            >
              {ALLOWED_INTERVALS.map((interval) => {
                const key = String(interval) as keyof typeof t.settings.scheduledRefresh.intervals;
                return (
                  <option key={interval} value={interval}>
                    {t.settings.scheduledRefresh.intervals[key]}
                  </option>
                );
              })}
            </select>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={mutation.isPending || selected === null || selected === currentInterval}
            >
              {mutation.isPending ? `${t.common.save}...` : t.common.save}
            </button>
          </div>
          {selected !== null && selected !== currentInterval && (
            <div className="settings-field-hint">→ {intervalLabel}</div>
          )}
        </div>
      )}
    </section>
  );
}
