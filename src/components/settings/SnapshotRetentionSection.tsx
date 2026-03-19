/**
 * 快照保留期限設定區塊。
 * 設定保留多少天的 repo 快照歷史資料。
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "../../i18n";
import { getSnapshotRetention, updateSnapshotRetention } from "../../api/client";
import { Skeleton } from "../Skeleton";

interface SnapshotRetentionSectionProps {
  onToast: (message: string, type?: "success" | "error") => void;
}

export function SnapshotRetentionSection({ onToast }: SnapshotRetentionSectionProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["settings", "snapshotRetention"],
    queryFn: ({ signal }) => getSnapshotRetention(signal),
  });

  const currentDays = data?.retention_days ?? 90;
  const [inputDays, setInputDays] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (days: number) => updateSnapshotRetention(days),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings", "snapshotRetention"] });
      setInputDays(null);
      onToast(t.settings.snapshotRetention.toast.saved, "success");
    },
    onError: () => {
      onToast(t.settings.snapshotRetention.toast.error, "error");
    },
  });

  const handleSave = () => {
    const days = parseInt(inputDays ?? "") || currentDays;
    if (days >= 30 && days <= 730 && days !== currentDays) {
      mutation.mutate(days);
    }
  };

  const isValid =
    inputDays !== null &&
    parseInt(inputDays) >= 30 &&
    parseInt(inputDays) <= 730 &&
    parseInt(inputDays) !== currentDays;

  return (
    <section className="settings-section" data-testid="snapshot-retention-section">
      <h2>{t.settings.snapshotRetention.title}</h2>
      <p className="settings-description">{t.settings.snapshotRetention.description}</p>

      {isLoading ? (
        <Skeleton width={200} height={40} variant="rounded" />
      ) : (
        <div className="settings-field">
          <label className="settings-field-label" htmlFor="snapshot-retention-input">
            {t.settings.snapshotRetention.days}
          </label>
          <div className="settings-interval-row">
            <input
              id="snapshot-retention-input"
              type="number"
              className="settings-number-input"
              min={30}
              max={730}
              value={inputDays !== null ? inputDays : currentDays}
              onChange={(e) => setInputDays(e.target.value)}
            />
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={mutation.isPending || !isValid}
            >
              {mutation.isPending ? `${t.common.save}...` : t.common.save}
            </button>
          </div>
          <div className="settings-field-hint">
            30–730 {t.settings.snapshotRetention.days.toLowerCase()}
          </div>
        </div>
      )}
    </section>
  );
}
