/**
 * Dashboard 頁面，總覽追蹤中的 repo 與關鍵指標。
 */

import { useI18n } from "../i18n";
import { useDashboard, DashboardStats, RecentActivity } from "../hooks/useDashboard";
import { EarlySignal, SignalSummary } from "../api/client";
import { AnimatedPage, FadeIn } from "../components/motion";
import { Skeleton } from "../components/Skeleton";
import { formatNumber, formatDelta, formatCompactRelativeTime } from "../utils/format";

// 訊號類型圖示對應
const SIGNAL_TYPE_CONFIG: Record<string, { icon: string; className: string }> = {
  rising_star: { icon: "\u{1F31F}", className: "signal-rising-star" },
  sudden_spike: { icon: "\u26A1", className: "signal-sudden-spike" },
  breakout: { icon: "\u{1F680}", className: "signal-breakout" },
  viral_hn: { icon: "\u{1F536}", className: "signal-viral-hn" },
};

const SEVERITY_CLASS: Record<string, string> = {
  high: "severity-high",
  medium: "severity-medium",
  low: "severity-low",
};

// 單一統計卡片
function StatCard({
  label,
  value,
  trend,
}: {
  label: string;
  value: string | number;
  trend?: "up" | "down" | "neutral";
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${trend ? `trend-${trend}` : ""}`}>{value}</div>
    </div>
  );
}

// 統計數據網格
function StatsGrid({ stats }: { stats: DashboardStats }) {
  const { t } = useI18n();

  return (
    <div className="stats-grid">
      <StatCard label={t.dashboard.stats.totalRepos} value={stats.totalRepos} />
      <StatCard label={t.dashboard.stats.totalStars} value={formatNumber(stats.totalStars)} />
      <StatCard
        label={t.dashboard.stats.weeklyStars}
        value={formatDelta(stats.weeklyStars)}
        trend={stats.weeklyStars > 0 ? "up" : stats.weeklyStars < 0 ? "down" : "neutral"}
      />
      <StatCard
        label={t.dashboard.stats.activeAlerts}
        value={stats.activeAlerts}
        trend={stats.activeAlerts > 0 ? "up" : "neutral"}
      />
    </div>
  );
}

// Signal Spotlight — 早期訊號焦點
function SignalSpotlight({
  signals,
  summary,
  onAcknowledge,
}: {
  signals: EarlySignal[];
  summary: SignalSummary | null;
  onAcknowledge: (id: number) => void;
}) {
  const { t } = useI18n();

  if (!summary || summary.total_active === 0) {
    return null;
  }

  const signalTypeLabels: Record<string, string> = {
    rising_star: t.dashboard.signals.types.risingStar,
    sudden_spike: t.dashboard.signals.types.suddenSpike,
    breakout: t.dashboard.signals.types.breakout,
    viral_hn: t.dashboard.signals.types.viralHn,
  };

  return (
    <div className="dashboard-section signal-spotlight">
      <div className="signal-spotlight-header">
        <h3>{t.dashboard.signals.title}</h3>
        <span className="signal-spotlight-count">{summary.total_active}</span>
      </div>

      {/* 訊號類型摘要 */}
      <div className="signal-type-summary">
        {Object.entries(summary.by_type).map(([type, count]) => {
          const config = SIGNAL_TYPE_CONFIG[type] || { icon: "?", className: "" };
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
            const config = SIGNAL_TYPE_CONFIG[signal.signal_type] || { icon: "?", className: "" };
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
                  <span className="signal-item-time">{formatCompactRelativeTime(signal.detected_at, t.dashboard.activity.justNow)}</span>
                  <button
                    className="btn btn-sm signal-ack-btn"
                    onClick={() => onAcknowledge(signal.id)}
                    title={t.dashboard.signals.acknowledge}
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
}

// Velocity 分佈圖表
function VelocityChart({ data }: { data: { label: string; count: number }[] }) {
  const { t } = useI18n();
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="dashboard-section">
      <h3>{t.dashboard.velocityDistribution}</h3>
      <div className="velocity-chart">
        {data.map((item) => (
          <div key={item.label} className="velocity-bar-container">
            <div className="velocity-label">{item.label}</div>
            <div className="velocity-bar-wrapper">
              <div
                className="velocity-bar"
                style={{ width: `${(item.count / maxCount) * 100}%` }}
              />
            </div>
            <div className="velocity-count">{item.count}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// 近期活動列表
function RecentActivityList({ activities }: { activities: RecentActivity[] }) {
  const { t } = useI18n();

  const getActivityIcon = (type: RecentActivity["type"]): string => {
    switch (type) {
      case "repo_added":
        return "+";
      case "alert_triggered":
        return "!";
      default:
        return "*";
    }
  };

  if (activities.length === 0) {
    return (
      <div className="dashboard-section">
        <h3>{t.dashboard.recentActivity}</h3>
        <div className="activity-empty">{t.dashboard.activity.empty}</div>
      </div>
    );
  }

  return (
    <div className="dashboard-section">
      <h3>{t.dashboard.recentActivity}</h3>
      <div className="activity-list">
        {activities.map((activity) => (
          <div key={activity.id} className={`activity-item activity-${activity.type}`}>
            <div className="activity-icon">{getActivityIcon(activity.type)}</div>
            <div className="activity-content">
              <div className="activity-title">{activity.title}</div>
              {activity.description && (
                <div className="activity-description">{activity.description}</div>
              )}
            </div>
            <div className="activity-time">{formatCompactRelativeTime(activity.timestamp, t.dashboard.activity.justNow)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Dashboard 主元件
export function Dashboard() {
  const { t } = useI18n();
  const {
    stats,
    recentActivity,
    velocityDistribution,
    earlySignals,
    signalSummary,
    acknowledgeSignal,
    isLoading,
    error,
    refresh,
  } = useDashboard();

  if (isLoading) {
    return (
      <AnimatedPage className="page dashboard-page">
        <header className="page-header">
          <h1 data-testid="page-title">{t.dashboard.title}</h1>
          <p className="subtitle">{t.dashboard.subtitle}</p>
        </header>

        {/* 統計網格骨架屏 */}
        <div className="stats-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="stat-card">
              <Skeleton width={100} height={16} style={{ marginBottom: 8 }} />
              <Skeleton width={60} height={32} />
            </div>
          ))}
        </div>

        <div className="dashboard-grid">
          {/* Velocity 圖表骨架屏 */}
          <div className="dashboard-section">
            <Skeleton width={150} height={24} style={{ marginBottom: 16 }} />
            <div className="velocity-chart">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="velocity-bar-container" style={{ gap: 8 }}>
                  <Skeleton width={40} height={16} />
                  <Skeleton
                    width="100%"
                    height={8}
                    style={{ flex: 1, opacity: 0.3 }}
                    variant="rounded"
                  />
                  <Skeleton width={20} height={16} />
                </div>
              ))}
            </div>
          </div>

          {/* 活動列表骨架屏 */}
          <div className="dashboard-section">
            <Skeleton width={150} height={24} style={{ marginBottom: 16 }} />
            <div className="activity-list">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="activity-item"
                  style={{ display: "flex", gap: 12, alignItems: "center" }}
                >
                  <Skeleton variant="circular" width={24} height={24} />
                  <div style={{ flex: 1 }}>
                    <Skeleton width="60%" height={16} style={{ marginBottom: 4 }} />
                    <Skeleton width="40%" height={12} />
                  </div>
                  <Skeleton width={40} height={12} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </AnimatedPage>
    );
  }

  if (error) {
    return (
      <div className="page">
        <div className="error-container">
          <h2>{t.common.error}</h2>
          <p>{error}</p>
          <button onClick={refresh} className="btn btn-primary">
            {t.common.retry}
          </button>
        </div>
      </div>
    );
  }

  return (
    <AnimatedPage className="page dashboard-page">
      <header className="page-header">
        <h1 data-testid="page-title">{t.dashboard.title}</h1>
        <p className="subtitle">{t.dashboard.subtitle}</p>
      </header>

      <FadeIn delay={0.1}>
        <StatsGrid stats={stats} />
      </FadeIn>

      <FadeIn delay={0.15}>
        <SignalSpotlight
          signals={earlySignals}
          summary={signalSummary}
          onAcknowledge={acknowledgeSignal}
        />
      </FadeIn>

      <FadeIn delay={0.2}>
        <div className="dashboard-grid">
          <VelocityChart data={velocityDistribution} />
          <RecentActivityList activities={recentActivity} />
        </div>
      </FadeIn>
    </AnimatedPage>
  );
}
