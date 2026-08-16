/**
 * Dashboard 狀態管理與統計資料運算。
 * 使用 React Query 管理資料快取與請求去重。
 */

import { useCallback, useMemo } from "react";
import { useI18n } from "../i18n";
import { getSignalDisplayName } from "../utils/signalTypeHelpers";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getRepos,
  listTriggeredAlerts,
  listEarlySignals,
  getSignalSummary,
  acknowledgeSignal,
  RepoWithSignals,
  TriggeredAlert,
} from "../api/client";
import type { EarlySignal } from "../api/types";
import { ALERT_FETCH_LIMIT } from "../constants/api";
import { queryKeys } from "../lib/react-query";
import { logger } from "../utils/logger";
import type { LanguageSlice } from "../components/dashboard/LanguageDistribution";
import type { HealthScoreInput } from "../components/dashboard/PortfolioHealthScore";

const EMPTY_REPOS: RepoWithSignals[] = [];
const EMPTY_ALERTS: TriggeredAlert[] = [];
const EMPTY_SIGNALS: EarlySignal[] = [];

export interface DashboardStats {
  totalRepos: number;
  totalStars: number;
  /**
   * null 代表沒有任何 repo 算得出 7 日差值（快照歷史不足），與「淨變化為 0」是兩件事。
   * 後端已經刻意用 null 表達「資料不足」（見 analyzer.calculate_delta），這裡不能抹平。
   */
  weeklyStars: number | null;
  activeAlerts: number;
}

/** velocity 分佈的桶。unknown = 快照歷史不足以計算，不屬於任何數值區間。 */
export type VelocityBucketKey = "negative" | "low" | "medium" | "high" | "veryHigh" | "unknown";

export interface VelocityBucket {
  key: VelocityBucketKey;
  count: number;
}

export interface RecentActivity {
  id: string;
  type: "repo_added" | "alert_triggered" | "early_signal_detected";
  title: string;
  description: string;
  timestamp: string;
}

export function useDashboard() {
  const { t } = useI18n();
  const qc = useQueryClient();

  const reposQuery = useQuery<RepoWithSignals[], Error>({
    queryKey: queryKeys.repos.lists(),
    queryFn: async () => {
      const response = await getRepos();
      return response.repos;
    },
  });

  const alertsQuery = useQuery({
    queryKey: queryKeys.alerts.triggered(),
    queryFn: () => listTriggeredAlerts(false, ALERT_FETCH_LIMIT),
  });

  // 取更多早期訊號（供 Recent Activity 使用，最多 20 筆）
  const signalsQuery = useQuery<EarlySignal[], Error>({
    queryKey: queryKeys.signals.dashboard(),
    queryFn: async () => {
      const response = await listEarlySignals({ limit: 20 });
      return response.signals;
    },
  });

  const summaryQuery = useQuery({
    queryKey: queryKeys.signals.summary(),
    queryFn: () => getSignalSummary(),
  });

  const repos = reposQuery.data ?? EMPTY_REPOS;
  const alerts = alertsQuery.data ?? EMPTY_ALERTS;
  const earlySignals = signalsQuery.data ?? EMPTY_SIGNALS;
  const signalSummary = summaryQuery.data ?? null;
  const isLoading =
    reposQuery.isLoading ||
    alertsQuery.isLoading ||
    signalsQuery.isLoading ||
    summaryQuery.isLoading;

  // 合併錯誤訊息
  const error = useMemo(() => {
    const errors = [reposQuery.error, alertsQuery.error, signalsQuery.error, summaryQuery.error]
      .filter((e): e is Error => e instanceof Error)
      .map((e) => e.message);
    return errors.length > 0 ? errors.join("; ") : null;
  }, [reposQuery.error, alertsQuery.error, signalsQuery.error, summaryQuery.error]);

  const handleAcknowledgeSignal = useCallback(
    async (signalId: number) => {
      try {
        await acknowledgeSignal(signalId);
        // 重新取得 signals 和 summary
        void qc.invalidateQueries({ queryKey: queryKeys.signals.all });
      } catch (err) {
        logger.warn("[useDashboard] 訊號確認失敗:", err);
      }
    },
    [qc]
  );

  // 從 repos 資料計算統計數值
  const stats: DashboardStats = useMemo(() => {
    const totalRepos = repos.length;
    const totalStars = repos.reduce((sum: number, r: RepoWithSignals) => sum + (r.stars ?? 0), 0);
    // 只加總算得出來的。全都算不出來時回 null 而不是 0——把「還沒有 7 天歷史」
    // 顯示成「這週一顆星都沒漲」是在說謊，而且新裝的 app 一定會落在這個狀態。
    const knownDeltas = repos
      .map((r: RepoWithSignals) => r.stars_delta_7d)
      .filter((d): d is number => d != null);
    const weeklyStars = knownDeltas.length > 0 ? knownDeltas.reduce((sum, d) => sum + d, 0) : null;
    const activeAlerts = alerts.filter((a: TriggeredAlert) => !a.acknowledged).length;

    return { totalRepos, totalStars, weeklyStars, activeAlerts };
  }, [repos, alerts]);

  // 從 repos、alerts 與 earlySignals 產生近期活動（top 10）
  const recentActivity: RecentActivity[] = useMemo(() => {
    const sources: Array<{ ts: string; build: () => RecentActivity }> = [];

    for (const repo of repos) {
      sources.push({
        ts: repo.added_at,
        build: () => ({
          id: `repo-${repo.id}`,
          type: "repo_added",
          title: repo.full_name,
          description: repo.description ?? "",
          timestamp: repo.added_at,
        }),
      });
    }

    for (const alert of alerts) {
      sources.push({
        ts: alert.triggered_at,
        build: () => ({
          id: `alert-${alert.id}`,
          type: "alert_triggered",
          title: alert.rule_name,
          description: `${alert.repo_name}: ${getSignalDisplayName(alert.signal_type, t.dashboard.signals.types)} ${alert.operator} ${alert.threshold}`,
          timestamp: alert.triggered_at,
        }),
      });
    }

    for (const signal of earlySignals) {
      sources.push({
        ts: signal.detected_at,
        build: () => ({
          id: `signal-${signal.id}`,
          type: "early_signal_detected",
          title: signal.repo_name,
          description: signal.description,
          timestamp: signal.detected_at,
        }),
      });
    }

    const withTime = sources.map((s) => ({ ...s, time: new Date(s.ts).getTime() }));
    withTime.sort((a, b) => b.time - a.time);
    return withTime.slice(0, 10).map((s) => s.build());
  }, [repos, alerts, earlySignals, t]);

  // 計算 velocity 分佈供圖表使用
  const velocityDistribution: VelocityBucket[] = useMemo(() => {
    const ranges = [
      { key: "negative" as const, min: -Infinity, max: 0, inclusive: false },
      { key: "low" as const, min: 0, max: 10, inclusive: false },
      { key: "medium" as const, min: 10, max: 50, inclusive: false },
      { key: "high" as const, min: 50, max: 100, inclusive: false },
      { key: "veryHigh" as const, min: 100, max: Infinity, inclusive: true },
    ];

    // velocity 為 null 的不落進 0-10 桶：那會讓「還沒算出來」看起來像「幾乎沒成長」，
    // 而剛裝好的 app 每一個 repo 都是 null，整張圖會全部擠在最低那一格。
    const known = repos.filter((r: RepoWithSignals) => r.velocity != null);
    const buckets: VelocityBucket[] = ranges.map((range) => ({
      key: range.key,
      count: known.filter((r: RepoWithSignals) => {
        const v = r.velocity as number;
        return v >= range.min && (range.inclusive ? v <= range.max : v < range.max);
      }).length,
    }));

    const unknown = repos.length - known.length;
    return unknown > 0 ? [...buckets, { key: "unknown", count: unknown }] : buckets;
  }, [repos]);

  // 語言分佈（合計 10 片：前 9 種具名語言 + Other，null 統一歸 Other）
  const languageDistribution: LanguageSlice[] = useMemo(() => {
    const langMap: Record<string, number> = {};
    for (const repo of repos) {
      const lang = repo.language ?? t.dashboard.languageDistribution.other;
      langMap[lang] = (langMap[lang] ?? 0) + 1;
    }
    const sorted = Object.entries(langMap).sort((a, b) => b[1] - a[1]);

    if (sorted.length <= 10) {
      return sorted.map(([language, count]) => ({ language, count }));
    }

    // 超過 10 種時：前 9 筆保留，第 10 筆起全部合併為「其他」
    const otherLabel = t.dashboard.languageDistribution.other;
    const top9Named = sorted.filter(([lang]) => lang !== otherLabel).slice(0, 9);
    const explicitOther = langMap[otherLabel] ?? 0;
    const overflowCount = sorted
      .filter(([lang]) => lang !== otherLabel)
      .slice(9)
      .reduce((sum, [, c]) => sum + c, 0);
    const combinedOther = explicitOther + overflowCount;

    return [
      ...top9Named.map(([language, count]) => ({ language, count })),
      ...(combinedOther > 0 ? [{ language: otherLabel, count: combinedOther }] : []),
    ];
  }, [repos, t]);

  // Portfolio 健康分數（0-100）
  const healthScoreInput: HealthScoreInput = useMemo(() => {
    const totalRepos = repos.length;
    if (totalRepos === 0) {
      return {
        score: null,
        activeAlerts: 0,
        totalRepos: 0,
        reposWithSignals: 0,
        highVelocityRepos: 0,
        staleRepos: 0,
        reposAwaitingHistory: 0,
      };
    }

    const activeAlerts = alerts.filter((a) => !a.acknowledged).length;
    const reposWithSignals = signalSummary?.repos_with_signals ?? 0;
    const highVelocityRepos =
      (velocityDistribution.find((d) => d.key === "high")?.count ?? 0) +
      (velocityDistribution.find((d) => d.key === "veryHigh")?.count ?? 0);

    // 停滯 = 算得出 velocity 且不成長。velocity 為 null 是「快照歷史還不夠算」，
    // 兩者混為一談的話，剛加入的 repo 在補滿歷史前都會被當成停滯而一直扣分。
    const measurable = repos.filter((r) => r.velocity != null);
    const staleRepos = measurable.filter((r) => (r.velocity as number) <= 0).length;
    const reposAwaitingHistory = totalRepos - measurable.length;

    // 一個 repo 都量不到成長時不給分數。這時候唯一有效的輸入只剩警報，
    // 硬算出來的分數是用四分之一的資訊冒充整體評估——寧可講「還在累積」。
    if (measurable.length === 0) {
      return {
        score: null,
        activeAlerts,
        totalRepos,
        reposWithSignals,
        highVelocityRepos,
        staleRepos,
        reposAwaitingHistory,
      };
    }

    // 三個比例共用同一個分母「量得到的 repo 數」。混用的話，加入一個還沒有歷史的
    // repo 會讓分數自己往下跳——它什麼都沒貢獻，卻稀釋了每一項的比例。
    // 訊號比例另外夾在 1 以內：repos_with_signals 由後端跨全部 repo 統計，
    // 理論上可能超過分母。
    const alertPenalty = Math.min(activeAlerts * 8, 40);
    const stalePenalty = (staleRepos / measurable.length) * 25;
    const signalBonus = Math.min(1, reposWithSignals / measurable.length) * 10;
    const accelBonus = (highVelocityRepos / measurable.length) * 10;

    const raw = 100 - alertPenalty - stalePenalty + signalBonus + accelBonus;
    const score = Math.max(0, Math.min(100, Math.round(raw)));

    return {
      score,
      activeAlerts,
      totalRepos,
      reposWithSignals,
      highVelocityRepos,
      staleRepos,
      reposAwaitingHistory,
    };
  }, [repos, alerts, signalSummary, velocityDistribution]);

  // Signal Spotlight 用的 earlySignals（取前 5 筆）
  const spotlightSignals = useMemo(() => earlySignals.slice(0, 5), [earlySignals]);

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: queryKeys.repos.all });
    void qc.invalidateQueries({ queryKey: queryKeys.alerts.all });
    void qc.invalidateQueries({ queryKey: queryKeys.signals.all });
    void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
  }, [qc]);

  return {
    stats,
    recentActivity,
    velocityDistribution,
    languageDistribution,
    healthScoreInput,
    earlySignals: spotlightSignals,
    signalSummary,
    acknowledgeSignal: handleAcknowledgeSignal,
    isLoading,
    isFetching: reposQuery.isFetching || alertsQuery.isFetching,
    dataUpdatedAt: reposQuery.dataUpdatedAt,
    error,
    refresh,
  };
}
