/**
 * Dashboard 頁面，總覽追蹤中的 repo 與關鍵指標。
 */

import { memo, useCallback, useState } from "react";
import { useI18n } from "../i18n";
import { useDashboard, DashboardStats, RecentActivity } from "../hooks/useDashboard";
import { AnimatedPage, FadeIn } from "../components/motion";
import { Skeleton } from "../components/Skeleton";
import { useAppStatus } from "../contexts/AppStatusContext";
import { useNavigation } from "../contexts/NavigationContext";
import { useWatchlistActions, useWatchlistState } from "../contexts/WatchlistContext";
import { formatNumber, formatDelta, formatRelativeTime } from "../utils/format";
import { AttentionBar } from "../components/dashboard/AttentionBar";
import { MoversPanel } from "../components/dashboard/MoversPanel";
import { WeeklySummary } from "../components/dashboard/WeeklySummary";
import { SignalSpotlight } from "../components/dashboard/SignalSpotlight";
import { VelocityChartRecharts } from "../components/dashboard/VelocityChartRecharts";
import { LanguageDistribution } from "../components/dashboard/LanguageDistribution";
import { DailyStarsChart } from "../components/dashboard/DailyStarsChart";
import { CategorySummary } from "../components/dashboard/CategorySummary";
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
  muted,
  onClick,
}: {
  label: string;
  value: string | number;
  trend?: "up" | "down" | "neutral";
  variant?: "accent" | "warning" | "success" | "danger";
  /** 值以說明文字呈現（非數字），縮小字級避免撐爆卡片 */
  muted?: boolean;
  onClick?: () => void;
}) {
  const className = `stat-card${variant ? ` stat-card--${variant}` : ""}`;
  const body = (
    <>
      <div className="stat-label">{label}</div>
      <div
        className={`stat-value ${trend ? `trend-${trend}` : ""}${muted ? " stat-value--muted" : ""}`}
      >
        {value}
      </div>
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={`${className} stat-card--clickable`} onClick={onClick}>
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
}

// 統計數據網格
const StatsGrid = memo(function StatsGrid({
  stats,
  hasAlertRules,
  onSetupRules,
}: {
  stats: DashboardStats;
  hasAlertRules: boolean;
  onSetupRules: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="stats-grid">
      <StatCard label={t.dashboard.stats.totalRepos} value={stats.totalRepos} variant="accent" />
      <StatCard
        label={t.dashboard.stats.totalStars}
        value={formatNumber(stats.totalStars)}
        variant="warning"
      />
      {/* null = 還沒有 7 天快照可比。顯示 0 會被讀成「這週沒漲」，那是另一件事。
          success 也只在真的有成長時亮，理由與下面的 danger 相同 */}
      <StatCard
        label={t.dashboard.stats.weeklyStars}
        value={stats.weeklyStars === null ? "—" : formatDelta(stats.weeklyStars)}
        trend={
          stats.weeklyStars === null
            ? undefined
            : stats.weeklyStars > 0
              ? "up"
              : stats.weeklyStars < 0
                ? "down"
                : "neutral"
        }
        variant={stats.weeklyStars !== null && stats.weeklyStars > 0 ? "success" : undefined}
      />
      {/* danger 只在真的有警報時亮：紅色永遠掛著，警報觸發時就沒有任何變化感。
          沒有任何規則時，0 是沒有資訊量的假安心（沒設規則永遠是 0）——
          改顯示「未設定規則」並讓卡片可點去設定 */}
      {hasAlertRules ? (
        <StatCard
          label={t.dashboard.stats.activeAlerts}
          value={stats.activeAlerts}
          variant={stats.activeAlerts > 0 ? "danger" : undefined}
        />
      ) : (
        <StatCard
          label={t.dashboard.stats.activeAlerts}
          value={t.dashboard.stats.noRulesYet}
          muted
          onClick={onSetupRules}
        />
      )}
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
              {/* 全相對時間（2w、3mo），不落回絕對日期：清單裡混著
                  「14h」與「2026/8/15」兩種格式，掃讀時要換兩次腦 */}
              {formatRelativeTime(activity.timestamp, {
                justNowText: t.dashboard.activity.justNow,
              })}
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
    earlySignals,
    signalSummary,
    movers,
    attentionItems,
    hasAlertRules,
    releasesChecked,
    acknowledgeSignal,
    isLoading,
    lastFetchAt,
    isFetchInProgress,
    error,
    refresh,
  } = useDashboard();

  // 寫入操作一律走 WatchlistContext action，不在元件裡直接呼叫 mutation
  const { refreshAll } = useWatchlistActions();
  const { loadingState } = useWatchlistState();
  // 兩個來源都要：本機旗標涵蓋「按下去到第一次輪詢回來」的空窗，伺服器旗標涵蓋
  // 「POST 已經返回但抓取還在跑」——只看本機的話撞到排程中的抓取會謊稱已完成
  const isRefreshing = loadingState.type === "refreshing" || isFetchInProgress;

  // ↻ 要做的是「讓新鮮度標籤能動」的那件事——真的去 GitHub 抓。
  // 只 invalidate 快取的話是重讀同一份本機資料，畫面不會有任何變化。
  const handleRefresh = useCallback(async () => {
    await refreshAll();
    refresh();
  }, [refreshAll, refresh]);

  // Portfolio History 的時間範圍（獨立 state，不影響 WeeklySummary）
  const [portfolioDays, setPortfolioDays] = useState<DashboardTimeRange>(30);

  // 小工具顯示/隱藏
  const [widgetVisibility, setWidgetVisibility] = useState<WidgetVisibility>(loadWidgetVisibility);

  const { level } = useAppStatus();
  const { navigateTo } = useNavigation();

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
    const message =
      level === "sidecar-down"
        ? t.status.sidecarDown
        : level === "offline"
          ? t.status.offline
          : error;
    return (
      <AnimatedPage className="page">
        <div className="error-container">
          <h2>{t.common.error}</h2>
          <p>{message}</p>
          <button onClick={refresh} className="btn btn-primary">
            {t.common.retry}
          </button>
        </div>
      </AnimatedPage>
    );
  }

  // watchlist 為空時整個監測層都沒有資料——與其渲染六個各自喊「沒資料」的模組，
  // 收斂成一張說明 + 出口的引導卡，把人導向唯一每天有新內容的探索頁
  if (stats.totalRepos === 0) {
    return (
      <AnimatedPage className="page dashboard-page">
        <header className="page-header">
          <h1 data-testid="page-title">{t.dashboard.title}</h1>
          <p className="subtitle">{t.dashboard.subtitle}</p>
        </header>
        <div className="dashboard-onboard" data-testid="dashboard-onboard">
          <h2>{t.dashboard.onboard.title}</h2>
          <p>{t.dashboard.onboard.description}</p>
          <button
            className="btn btn-primary"
            data-testid="dashboard-onboard-cta"
            onClick={() => navigateTo("discovery")}
          >
            {t.common.goDiscover}
          </button>
        </div>
      </AnimatedPage>
    );
  }

  // 顯示的是後端最後一次真的跟 GitHub 對過的時間（lastFetchAt），不是前端最後一次
  // 收到 HTTP 回應的時間——後者重讀一次本機 DB 就會變「剛剛」，跟資料新舊無關
  // 用 formatRelativeTime 而非同頁其他地方的 formatCompactRelativeTime：後者一小時內
  // 一律回「剛剛」，而排程是每 30 分鐘抓一次——沒有分鐘刻度的話這個標籤幾乎永遠是
  // 「剛剛」，換了資料來源也還是分不出「剛抓完」與「已經 59 分鐘沒抓」
  const freshnessLabel = lastFetchAt
    ? formatRelativeTime(lastFetchAt, { justNowText: t.dashboard.activity.justNow })
    : t.dashboard.attention.neverFetched;

  return (
    <AnimatedPage className="page dashboard-page">
      <header className="page-header dashboard-page-header">
        <div>
          <h1 data-testid="page-title">{t.dashboard.title}</h1>
          <p className="subtitle">{t.dashboard.subtitle}</p>
        </div>
        <WidgetCustomizer visibility={widgetVisibility} onChange={setWidgetVisibility} />
      </header>

      {/* 段一：需要注意。取代原本的四張統計卡與健康分數卡——那些合計 293px，
          只為了說「沒事」。同時取代 DataFreshnessBar：更新時間與手動重整
          都在這裡，沒有別的入口了，所以不放進 FadeIn 的延遲佇列——這是
          使用者最先要看到的東西 */}
      <AttentionBar
        items={attentionItems}
        totalRepos={stats.totalRepos}
        hasAlertRules={hasAlertRules}
        releasesChecked={releasesChecked}
        updatedLabel={freshnessLabel}
        isRefreshing={isRefreshing}
        onRefresh={handleRefresh}
      />

      {/* 四張卡的數字已各有去處（見上方 AttentionBar 與下方 MoversPanel 的標題），
          預設關閉但保留——是否留著這一排是使用者的判斷，不是實作者能替他決定的事 */}
      {widgetVisibility.statsGrid && (
        <FadeIn delay={0.1}>
          <StatsGrid
            stats={stats}
            hasAlertRules={hasAlertRules}
            onSetupRules={() => navigateTo("settings")}
          />
        </FadeIn>
      )}

      {/* 段二：持久在上、即時在下。SignalSpotlight 會記得幾天前的暴衝，
          排行只知道此刻——「不要錯過」需要前者 */}
      <FadeIn delay={0.12}>
        {widgetVisibility.signalSpotlight && (
          <SignalSpotlight
            signals={earlySignals}
            summary={signalSummary}
            totalRepos={stats.totalRepos}
            onAcknowledge={acknowledgeSignal}
          />
        )}
      </FadeIn>
      <FadeIn delay={0.15}>
        <MoversPanel result={movers} />
      </FadeIn>

      {/* 段三：可讀（固定 7 天，與 Portfolio History 的時間範圍獨立） */}
      {widgetVisibility.weeklySummary && (
        <FadeIn delay={0.18}>
          <WeeklySummary />
        </FadeIn>
      )}

      {/* 每日新增星數（有自己的時間範圍選擇器） */}
      {widgetVisibility.portfolioHistory && (
        <FadeIn delay={0.2}>
          <DailyStarsChart days={portfolioDays} onChangeDays={setPortfolioDays} />
        </FadeIn>
      )}

      {/* Velocity 分佈 + 語言分佈（並排，至少一個可見才渲染） */}
      {(widgetVisibility.velocityChart || widgetVisibility.languageDistribution) && (
        <FadeIn delay={0.22}>
          <div className="dashboard-grid">
            {widgetVisibility.velocityChart && stats.totalRepos > 0 && (
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
