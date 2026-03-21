/**
 * 系統診斷區塊，顯示 sidecar 狀態、資料庫資訊、最後同步時間。
 */

import { useQuery } from "@tanstack/react-query";
import { getDiagnostics, DiagnosticsResponse } from "../../api/client";
import { useI18n } from "../../i18n";
import { queryKeys } from "../../lib/react-query";
import { formatRelativeTime } from "../../utils/format";

/** 格式化秒數為可讀的時間。 */
function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function DiagnosticsSection() {
  const { t } = useI18n();

  const { data, isLoading, error } = useQuery<DiagnosticsResponse>({
    queryKey: [...queryKeys.connection.all, "diagnostics"],
    queryFn: ({ signal }) => getDiagnostics(signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  return (
    <div className="settings-section" id="diagnostics" data-testid="diagnostics-section">
      <h2>{t.settings.diagnostics?.title ?? "系統診斷"}</h2>
      <p className="section-description">
        {t.settings.diagnostics?.description ?? "Sidecar 狀態與資料庫資訊"}
      </p>

      {isLoading && <p>{t.common.loading}</p>}
      {error && <p className="error-text">{t.common.error}</p>}

      {data && (
        <div className="diagnostics-grid">
          <div className="diagnostics-item">
            <span className="diagnostics-label">{t.settings.diagnostics?.version ?? "版本"}</span>
            <span className="diagnostics-value">{data.version}</span>
          </div>
          <div className="diagnostics-item">
            <span className="diagnostics-label">
              {t.settings.diagnostics?.uptime ?? "運行時間"}
            </span>
            <span className="diagnostics-value">{formatUptime(data.uptime_seconds)}</span>
          </div>
          <div className="diagnostics-item">
            <span className="diagnostics-label">
              {t.settings.diagnostics?.dbSize ?? "資料庫大小"}
            </span>
            <span className="diagnostics-value">{data.db_size_mb} MB</span>
          </div>
          <div className="diagnostics-item">
            <span className="diagnostics-label">
              {t.settings.diagnostics?.totalRepos ?? "追蹤 Repo"}
            </span>
            <span className="diagnostics-value">{data.total_repos}</span>
          </div>
          <div className="diagnostics-item">
            <span className="diagnostics-label">
              {t.settings.diagnostics?.totalSnapshots ?? "快照數量"}
            </span>
            <span className="diagnostics-value">{data.total_snapshots}</span>
          </div>
          <div className="diagnostics-item">
            <span className="diagnostics-label">
              {t.settings.diagnostics?.lastSync ?? "最後同步"}
            </span>
            <span className="diagnostics-value">
              {data.last_snapshot_at ? formatRelativeTime(new Date(data.last_snapshot_at)) : "—"}
            </span>
          </div>
          <div className="diagnostics-item">
            <span className="diagnostics-label">
              {t.settings.diagnostics?.dbPath ?? "資料庫路徑"}
            </span>
            <span className="diagnostics-value diagnostics-path">{data.db_path}</span>
          </div>
        </div>
      )}
    </div>
  );
}
