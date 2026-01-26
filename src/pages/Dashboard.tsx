/**
 * Dashboard page - overview of tracked repositories and key metrics.
 */

import { useI18n } from "../i18n";
import { useDashboard, DashboardStats, RecentActivity } from "../hooks/useDashboard";
import { AnimatedPage, FadeIn } from "../components/motion";

// Stat card component
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
      <div className={`stat-value ${trend ? `trend-${trend}` : ""}`}>
        {value}
      </div>
    </div>
  );
}

// Stats grid component
function StatsGrid({ stats }: { stats: DashboardStats }) {
  const { t } = useI18n();

  const formatNumber = (num: number): string => {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toLocaleString();
  };

  const formatDelta = (num: number): string => {
    if (num > 0) return `+${formatNumber(num)}`;
    return formatNumber(num);
  };

  return (
    <div className="stats-grid">
      <StatCard
        label={t.dashboard.stats.totalRepos}
        value={stats.totalRepos}
      />
      <StatCard
        label={t.dashboard.stats.totalStars}
        value={formatNumber(stats.totalStars)}
      />
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

// Velocity distribution chart component
function VelocityChart({
  data,
}: {
  data: { label: string; count: number }[];
}) {
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

// Recent activity component
function RecentActivityList({ activities }: { activities: RecentActivity[] }) {
  const { t } = useI18n();

  const formatTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffHours < 1) return t.dashboard.activity.justNow;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString();
  };

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
            <div className="activity-time">{formatTime(activity.timestamp)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Main Dashboard component
export function Dashboard() {
  const { t } = useI18n();
  const { stats, recentActivity, velocityDistribution, isLoading, error, refresh } = useDashboard();

  if (isLoading) {
    return (
      <div className="page">
        <div className="loading">{t.common.loading}</div>
      </div>
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

      <FadeIn delay={0.2}>
        <div className="dashboard-grid">
          <VelocityChart data={velocityDistribution} />
          <RecentActivityList activities={recentActivity} />
        </div>
      </FadeIn>
    </AnimatedPage>
  );
}
