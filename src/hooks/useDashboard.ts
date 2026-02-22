/**
 * Dashboard 狀態管理與統計資料運算。
 * 使用 React Query 管理資料快取與請求去重。
 */

import { useCallback, useMemo } from "react";
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
import { queryKeys } from "../lib/react-query";
import { logger } from "../utils/logger";

const EMPTY_REPOS: RepoWithSignals[] = [];
const EMPTY_ALERTS: TriggeredAlert[] = [];
const EMPTY_SIGNALS: EarlySignal[] = [];

export interface DashboardStats {
  totalRepos: number;
  totalStars: number;
  weeklyStars: number;
  activeAlerts: number;
}

export interface RecentActivity {
  id: string;
  type: "repo_added" | "alert_triggered";
  title: string;
  description: string;
  timestamp: string;
}

export function useDashboard() {
  const qc = useQueryClient();

  const reposQuery = useQuery({
    queryKey: queryKeys.repos.lists(),
    queryFn: () => getRepos(),
    select: (data) => data.repos,
  });

  const alertsQuery = useQuery({
    queryKey: queryKeys.alerts.triggered(),
    queryFn: () => listTriggeredAlerts(false, 50),
  });

  const signalsQuery = useQuery({
    queryKey: queryKeys.signals.dashboard(),
    queryFn: () => listEarlySignals({ limit: 5 }),
    select: (data) => data.signals,
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
    const weeklyStars = repos.reduce(
      (sum: number, r: RepoWithSignals) => sum + (r.stars_delta_7d ?? 0),
      0
    );
    const activeAlerts = alerts.filter((a: TriggeredAlert) => !a.acknowledged).length;

    return { totalRepos, totalStars, weeklyStars, activeAlerts };
  }, [repos, alerts]);

  // 從 repos 與 alerts 產生近期活動（只建立 top 10 的完整物件）
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
          description: `${alert.repo_name}: ${alert.signal_type} ${alert.operator} ${alert.threshold}`,
          timestamp: alert.triggered_at,
        }),
      });
    }

    return sources
      .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
      .slice(0, 10)
      .map((s) => s.build());
  }, [repos, alerts]);

  // 計算 velocity 分佈供圖表使用
  const velocityDistribution = useMemo(() => {
    const ranges = [
      { key: "negative" as const, min: -Infinity, max: 0, inclusive: false },
      { key: "low" as const, min: 0, max: 10, inclusive: false },
      { key: "medium" as const, min: 10, max: 50, inclusive: false },
      { key: "high" as const, min: 50, max: 100, inclusive: false },
      { key: "veryHigh" as const, min: 100, max: Infinity, inclusive: true },
    ];

    return ranges.map((range) => ({
      key: range.key,
      count: repos.filter((r: RepoWithSignals) => {
        const v = r.velocity ?? 0;
        return v >= range.min && (range.inclusive ? v <= range.max : v < range.max);
      }).length,
    }));
  }, [repos]);

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: queryKeys.repos.all });
    void qc.invalidateQueries({ queryKey: queryKeys.alerts.all });
    void qc.invalidateQueries({ queryKey: queryKeys.signals.all });
  }, [qc]);

  return {
    stats,
    recentActivity,
    velocityDistribution,
    earlySignals,
    signalSummary,
    acknowledgeSignal: handleAcknowledgeSignal,
    isLoading,
    error,
    refresh,
  };
}
