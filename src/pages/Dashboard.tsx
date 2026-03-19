/**
 * Dashboard 頁面，總覽追蹤中的 repo 與關鍵指標。
 */

import { memo, useState } from "react";
import { useI18n } from "../i18n";
import { useDashboard, DashboardStats, RecentActivity } from "../hooks/useDashboard";
import { AnimatedPage, FadeIn } from "../components/motion";
import { Skeleton } from "../components/Skeleton";
import { formatNumber, formatDelta, formatCompactRelativeTime } from "../utils/format";
import { WeeklySummary } from "../components/dashboard/WeeklySummary";
import { SignalSpotlight } from "../components/dashboard/SignalSpotlight";
import { VelocityChartRecharts } from "../components/dashboard/VelocityChartRecharts";
import { LanguageDistribution } from "../components/dashboard/LanguageDistribution";
import { PortfolioHistory } from "../components/dashboard/PortfolioHistory";
import { CategorySummary } from "../components/dashboard/CategorySummary";
import { PortfolioHealthScore } from "../components/dashboard/PortfolioHealthScore";
import {
  WidgetCustomizer,
  WidgetVisibility,
  loadWidgetVisibility,
} from "../components/dashboard/WidgetCustomizer";
import type { DashboardTimeRange } from "../api/types";

// 單一統計卡片
function StatCard({
  label,
  value,
  trend,
  variant,
}: {
  label: string;
  value: string | number;
  trend?: "up" | "down" | "neutral";
  variant?: "accent" | "warning" | "success" | "danger";
}) {
  return (
    <div className={`stat-card${variant ? ` stat-card--${variant}` : ""}`}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${trend ? `trend-${trend}` : ""}`}>{value}</div>
    </div>
  );
}

// 統計數據網格
const StatsGrid = memo(function StatsGrid({ stats }: { stats: DashboardStats }) {
  const { t } = useI18n();

  return (
    <div className="stats-grid">
      <StatCard label={t.dashboard.stats.totalRepos} value={stats.totalRepos} variant="accent" />
      <StatCard
        label={t.dashboard.stats.totalStars}
        value={formatNumber(stats.totalStars)}
        variant="warning"
      />
      <StatCard
        label={t.dashboard.stats.weeklyStars}
        value={formatDelta(stats.weeklyStars)}
        trend={stats.weeklyStars > 0 ? "up" : stats.weeklyStars < 0 ? "down" : "neutral"}
        variant="success"
      />
      <StatCard
        label={t.dashboard.stats.activeAlerts}
        value={stats.activeAlerts}
        trend={stats.activeAlerts > 0 ? "up" : "neutral"}
        variant="danger"
      />
    </div>
  );
});

// 近期活動列表
const RecentActivityList = memo(function RecentActivityList({
  activities,
}: {
  activities: RecentActivity[];
}) {
  const { t } = useI18n();

  const getActivityIcon = (type: RecentActivity["type"]): string => {
    switch (type) {
      case "repo_added":
        return "+";
      case "alert_triggered":
        return "!";
      case "early_signal_detected":
        return "★";
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
            <div className="activity-time">
              {formatCompactRelativeTime(activity.timestamp, t.dashboard.activity.justNow)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

// Dashboard 主元件
export function Dashboard() {
  const { t } = useI18n();
  const {
    stats,
    recentActivity,
    velocityDistribution,
    languageDistribution,
    healthScoreInput,
    earlySignals,
    signalSummary,
    acknowledgeSignal,
    isLoading,
    error,
    refresh,
  } = useDashboard();

  // Portfolio History 的時間範圍（獨立 state，不影響 WeeklySummary）
  const [portfolioDays, setPortfolioDays] = useState<DashboardTimeRange>(30);

  // 小工具顯示/隱藏
  const [widgetVisibility, setWidgetVisibility] = useState<WidgetVisibility>(loadWidgetVisibility);

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
            <Skeleton width="100%" height={180} variant="rounded" />
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
      <AnimatedPage className="page">
        <div className="error-container">
          <h2>{t.common.error}</h2>
          <p>{error}</p>
          <button onClick={refresh} className="btn btn-primary">
            {t.common.retry}
          </button>
        </div>
      </AnimatedPage>
    );
  }

  return (
    <AnimatedPage className="page dashboard-page">
      <header className="page-header dashboard-page-header">
        <div>
          <h1 data-testid="page-title">{t.dashboard.title}</h1>
          <p className="subtitle">{t.dashboard.subtitle}</p>
        </div>
        <WidgetCustomizer visibility={widgetVisibility} onChange={setWidgetVisibility} />
      </header>

      <FadeIn delay={0.1}>
        <StatsGrid stats={stats} />
      </FadeIn>

      {/* 健康分數 */}
      {widgetVisibility.portfolioHealth && (
        <FadeIn delay={0.12}>
          <PortfolioHealthScore input={healthScoreInput} />
        </FadeIn>
      )}

      {/* Signal Spotlight */}
      {widgetVisibility.signalSpotlight && (
        <FadeIn delay={0.15}>
          <SignalSpotlight
            signals={earlySignals}
            summary={signalSummary}
            onAcknowledge={acknowledgeSignal}
          />
        </FadeIn>
      )}

      {/* 週期摘要（固定 7 天，與 Portfolio History 時間範圍獨立） */}
      {widgetVisibility.weeklySummary && (
        <FadeIn delay={0.18}>
          <WeeklySummary />
        </FadeIn>
      )}

      {/* Portfolio 歷史（有自己的時間範圍選擇器） */}
      {widgetVisibility.portfolioHistory && (
        <FadeIn delay={0.2}>
          <PortfolioHistory days={portfolioDays} onChangeDays={setPortfolioDays} />
        </FadeIn>
      )}

      {/* Velocity 分佈 + 語言分佈（並排，至少一個可見才渲染） */}
      {(widgetVisibility.velocityChart || widgetVisibility.languageDistribution) && (
        <FadeIn delay={0.22}>
          <div className="dashboard-grid">
            {widgetVisibility.velocityChart && (
              <VelocityChartRecharts data={velocityDistribution} />
            )}
            {widgetVisibility.languageDistribution && (
              <LanguageDistribution data={languageDistribution} />
            )}
          </div>
        </FadeIn>
      )}

      {/* 分類摘要 + 近期活動（並排，至少一個可見才渲染） */}
      {(widgetVisibility.categorySummary || widgetVisibility.recentActivity) && (
        <FadeIn delay={0.25}>
          <div className="dashboard-grid">
            {widgetVisibility.categorySummary && <CategorySummary />}
            {widgetVisibility.recentActivity && <RecentActivityList activities={recentActivity} />}
          </div>
        </FadeIn>
      )}
    </AnimatedPage>
  );
}
