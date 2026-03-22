/**
 * 系統診斷區塊，顯示 sidecar 狀態、資料庫資訊、最後同步時間。
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDiagnostics, getGitHubConnectionStatus, DiagnosticsResponse } from "../../api/client";
import { useI18n } from "../../i18n";
import { queryKeys } from "../../lib/react-query";
import { formatRelativeTime } from "../../utils/format";

/** 格式化秒數為可讀的時間。 */
function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds)}s`;
}

export function DiagnosticsSection() {
  const { t } = useI18n();
  const [exporting, setExporting] = useState(false);

  const { data, isLoading, error } = useQuery<DiagnosticsResponse>({
    queryKey: [...queryKeys.connection.all, "diagnostics"],
    queryFn: ({ signal }) => getDiagnostics(signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const ghQuery = useQuery({
    queryKey: [...queryKeys.connection.all, "rate-limit"],
    queryFn: () => getGitHubConnectionStatus(),
    staleTime: 60_000,
  });

  const handleExportLogs = async () => {
    setExporting(true);
    try {
      const resp = await fetch("/api/settings/logs");
      const json = await resp.json();
      const logs = json.data?.logs ?? "（無日誌）";
      const blob = new Blob([logs], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `starscope-logs-${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="settings-section" id="diagnostics" data-testid="diagnostics-section">
      <h2>{t.settings.diagnostics.title}</h2>
      <p className="section-description">{t.settings.diagnostics.description}</p>

      {isLoading && <p>{t.common.loading}</p>}
      {error && <p className="error-text">{t.common.error}</p>}

      {data && (
        <>
          <div className="diagnostics-grid">
            <div className="diagnostics-item">
              <span className="diagnostics-label">{t.settings.diagnostics.version}</span>
              <span className="diagnostics-value">{data.version}</span>
            </div>
            <div className="diagnostics-item">
              <span className="diagnostics-label">{t.settings.diagnostics.uptime}</span>
              <span className="diagnostics-value">{formatUptime(data.uptime_seconds)}</span>
            </div>
            <div className="diagnostics-item">
              <span className="diagnostics-label">{t.settings.diagnostics.dbSize}</span>
              <span className="diagnostics-value">{data.db_size_mb} MB</span>
            </div>
            <div className="diagnostics-item">
              <span className="diagnostics-label">{t.settings.diagnostics.totalRepos}</span>
              <span className="diagnostics-value">{data.total_repos}</span>
            </div>
            <div className="diagnostics-item">
              <span className="diagnostics-label">{t.settings.diagnostics.totalSnapshots}</span>
              <span className="diagnostics-value">{data.total_snapshots}</span>
            </div>
            <div className="diagnostics-item">
              <span className="diagnostics-label">{t.settings.diagnostics.lastSync}</span>
              <span className="diagnostics-value">
                {data.last_snapshot_at ? formatRelativeTime(new Date(data.last_snapshot_at)) : "—"}
              </span>
            </div>
            <div className="diagnostics-item">
              <span className="diagnostics-label">{t.settings.diagnostics.dbPath}</span>
              <span className="diagnostics-value diagnostics-path">{data.db_path}</span>
            </div>
            <div className="diagnostics-item">
              <span className="diagnostics-label">{t.settings.diagnostics.lastFetchSuccess}</span>
              <span className="diagnostics-value">
                {data.last_fetch_success
                  ? formatRelativeTime(new Date(data.last_fetch_success))
                  : "—"}
              </span>
            </div>
            {data.last_fetch_error && (
              <div className="diagnostics-item" style={{ gridColumn: "1 / -1" }}>
                <span className="diagnostics-label">{t.settings.diagnostics.lastFetchError}</span>
                <span className="diagnostics-value" style={{ color: "var(--danger-fg)" }}>
                  {data.last_fetch_error}
                </span>
              </div>
            )}
            <div className="diagnostics-item">
              <span className="diagnostics-label">{t.settings.diagnostics.lastAlertCheck}</span>
              <span className="diagnostics-value">
                {data.last_alert_check ? formatRelativeTime(new Date(data.last_alert_check)) : "—"}
              </span>
            </div>
            <div className="diagnostics-item">
              <span className="diagnostics-label">{t.settings.diagnostics.lastBackup}</span>
              <span className="diagnostics-value">
                {data.last_backup ? formatRelativeTime(new Date(data.last_backup)) : "—"}
              </span>
            </div>
            {/* GitHub API 配額 */}
            {ghQuery.data?.rate_limit_remaining != null && (
              <div className="diagnostics-item">
                <span className="diagnostics-label">{t.settings.diagnostics.rateLimit}</span>
                <span className="diagnostics-value">
                  {ghQuery.data.rate_limit_remaining} / {ghQuery.data.rate_limit_total}
                </span>
              </div>
            )}
          </div>

          {/* 日誌匯出 */}
          <button
            type="button"
            className="btn btn-outline"
            onClick={handleExportLogs}
            disabled={exporting}
            style={{ marginTop: 16 }}
          >
            {exporting ? t.common.loading : t.settings.diagnostics.exportLogs}
          </button>
        </>
      )}
    </div>
  );
}
