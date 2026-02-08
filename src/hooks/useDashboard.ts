/**
 * Dashboard 狀態管理與統計資料運算。
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  getRepos,
  listTriggeredAlerts,
  listEarlySignals,
  getSignalSummary,
  acknowledgeSignal,
  RepoWithSignals,
  TriggeredAlert,
  EarlySignal,
  SignalSummary,
} from "../api/client";

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
  const [repos, setRepos] = useState<RepoWithSignals[]>([]);
  const [alerts, setAlerts] = useState<TriggeredAlert[]>([]);
  const [earlySignals, setEarlySignals] = useState<EarlySignal[]>([]);
  const [signalSummary, setSignalSummary] = useState<SignalSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 避免 StrictMode 重複請求
  const hasFetchedRef = useRef(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const results = await Promise.allSettled([
      getRepos(),
      listTriggeredAlerts(false),
      listEarlySignals({ limit: 5 }),
      getSignalSummary(),
    ]);

    const [reposResult, alertsResult, signalsResult, summaryResult] = results;

    if (reposResult.status === "fulfilled") setRepos(reposResult.value.repos);
    if (alertsResult.status === "fulfilled") setAlerts(alertsResult.value);
    if (signalsResult.status === "fulfilled") setEarlySignals(signalsResult.value.signals);
    if (summaryResult.status === "fulfilled") setSignalSummary(summaryResult.value);

    const failures = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected"
    );
    if (failures.length > 0) {
      setError(
        failures
          .map((f) => (f.reason instanceof Error ? f.reason.message : String(f.reason)))
          .join("; ")
      );
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    void loadData();
  }, [loadData]);

  const handleAcknowledgeSignal = useCallback(async (signalId: number) => {
    try {
      await acknowledgeSignal(signalId);
      setEarlySignals((prev) => prev.filter((s) => s.id !== signalId));
      setSignalSummary((prev) =>
        prev ? { ...prev, total_active: Math.max(0, prev.total_active - 1) } : prev
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[useDashboard] Failed to acknowledge signal:", err);
    }
  }, []);

  // 從 repos 資料計算統計數值
  const stats: DashboardStats = useMemo(() => {
    const totalRepos = repos.length;
    const totalStars = repos.reduce((sum, r) => sum + (r.stars ?? 0), 0);
    const weeklyStars = repos.reduce((sum, r) => sum + (r.stars_delta_7d ?? 0), 0);
    const activeAlerts = alerts.filter((a) => !a.acknowledged).length;

    return {
      totalRepos,
      totalStars,
      weeklyStars,
      activeAlerts,
    };
  }, [repos, alerts]);

  // 從 repos 與 alerts 產生近期活動
  const recentActivity: RecentActivity[] = useMemo(() => {
    const activities: RecentActivity[] = [];

    // 將所有 repos 加為活動項目
    for (const repo of repos) {
      activities.push({
        id: `repo-${repo.id}`,
        type: "repo_added",
        title: repo.full_name,
        description: repo.description ?? "",
        timestamp: repo.added_at,
      });
    }

    // 將所有 alerts 加為活動項目
    for (const alert of alerts) {
      activities.push({
        id: `alert-${alert.id}`,
        type: "alert_triggered",
        title: alert.rule_name,
        description: `${alert.repo_name}: ${alert.signal_type} ${alert.operator} ${alert.threshold}`,
        timestamp: alert.triggered_at,
      });
    }

    // 依時間排序並回傳前 10 筆
    return activities
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 10);
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
      count: repos.filter((r) => {
        const v = r.velocity ?? 0;
        // 最後一個區間使用包含上界
        return v >= range.min && (range.inclusive ? v <= range.max : v < range.max);
      }).length,
    }));
  }, [repos]);

  return {
    stats,
    recentActivity,
    velocityDistribution,
    earlySignals,
    signalSummary,
    acknowledgeSignal: handleAcknowledgeSignal,
    isLoading,
    error,
    refresh: loadData,
  };
}
