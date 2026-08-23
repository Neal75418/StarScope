/**
 * Dashboard 的早期信號聚光燈 Widget，顯示活躍的異常偵測訊號摘要。
 */

import { memo, useMemo } from "react";
import { useI18n, interpolate } from "../../i18n";
import type { EarlySignal, SignalSummary } from "../../api/client";
import { formatCompactRelativeTime } from "../../utils/format";
import { getSignalTypeConfig } from "../../constants/signalTypes";

const SEVERITY_CLASS: Record<string, string> = {
  high: "severity-high",
  medium: "severity-medium",
  low: "severity-low",
};

// Signal Spotlight — 早期訊號焦點
export const SignalSpotlight = memo(function SignalSpotlight({
  signals,
  summary,
  totalRepos,
  onAcknowledge,
}: {
  signals: EarlySignal[];
  summary: SignalSummary | null;
  /** 追蹤中的 repo 數，用來說明「檢查涵蓋了多少東西」 */
  totalRepos: number;
  onAcknowledge: (id: number) => void;
}) {
  const { t } = useI18n();

  const signalTypeLabels = useMemo<Record<string, string>>(
    () => ({
      rising_star: t.dashboard.signals.types.risingStar,
      sudden_spike: t.dashboard.signals.types.suddenSpike,
      breakout: t.dashboard.signals.types.breakout,
      viral_hn: t.dashboard.signals.types.viralHn,
    }),
    [t]
  );

  // 還沒拿到摘要＝不知道有沒有訊號，這時什麼都不說才對
  if (!summary) {
    return null;
  }

  // 沒有訊號時仍然渲染，而且要講清楚兩件事：檢查跑過了、涵蓋了多少東西。
  // 原本這裡直接 return null，於是「偵測器從未被呼叫」（2026-08-23 之前的真實狀況）
  // 與「跑過但沒東西」在畫面上完全一樣——使用者唯一合理的推論是功能壞了。
  //
  // snapshot_days_covered 是第二句話的依據：breakout 需要 stars_delta_30d，
  // 而那需要 30 天前的快照。少了這句，使用者無法分辨「這個功能對我沒用」
  // 與「還沒到能判斷的時候」。
  if (summary.total_active === 0) {
    const warmingUp = summary.snapshot_days_covered < 30;
    return (
      <div className="dashboard-section signal-spotlight" data-testid="signal-spotlight-empty">
        <div className="signal-spotlight-header">
          <h3>{t.dashboard.signals.title}</h3>
        </div>
        <p className="signal-spotlight-empty-text">
          {interpolate(t.dashboard.signals.emptyChecked, { count: totalRepos })}
        </p>
        {warmingUp && (
          <p className="signal-spotlight-empty-hint">
            {interpolate(t.dashboard.signals.emptyWarmingUp, {
              days: summary.snapshot_days_covered,
            })}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="dashboard-section signal-spotlight">
      <div className="signal-spotlight-header">
        <h3>{t.dashboard.signals.title}</h3>
        <span className="signal-spotlight-count">{summary.total_active}</span>
      </div>

      {/* 訊號類型摘要 */}
      <div className="signal-type-summary">
        {Object.entries(summary.by_type).map(([type, count]) => {
          const config = getSignalTypeConfig(type);
          return (
            <div key={type} className={`signal-type-chip ${config.className}`}>
              <span className="signal-type-icon">{config.icon}</span>
              <span className="signal-type-label">{signalTypeLabels[type] || type}</span>
              <span className="signal-type-count">{count}</span>
            </div>
          );
        })}
      </div>

      {/* 最新訊號列表 */}
      {signals.length > 0 && (
        <div className="signal-list">
          {signals.map((signal) => {
            const config = getSignalTypeConfig(signal.signal_type);
            const severityClass = SEVERITY_CLASS[signal.severity] || "";
            return (
              <div key={signal.id} className={`signal-item ${config.className}`}>
                <span className="signal-item-icon">{config.icon}</span>
                <div className="signal-item-content">
                  <div className="signal-item-header">
                    <span className="signal-item-repo">{signal.repo_name}</span>
                    <span className={`signal-severity-badge ${severityClass}`}>
                      {signal.severity}
                    </span>
                  </div>
                  <div className="signal-item-desc">{signal.description}</div>
                </div>
                <div className="signal-item-actions">
                  <span className="signal-item-time">
                    {formatCompactRelativeTime(signal.detected_at, t.dashboard.activity.justNow)}
                  </span>
                  <button
                    className="btn btn-sm signal-ack-btn"
                    onClick={() => onAcknowledge(signal.id)}
                    title={t.dashboard.signals.acknowledge}
                    aria-label={t.dashboard.signals.acknowledge}
                  >
                    ✓
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
