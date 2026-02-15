/**
 * Dashboard 狀態管理與統計資料運算。
 */

import { useState, useCallback, useRef, useMemo } from "react";
import { useOnceEffect } from "./useOnceEffect";
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
import { logger } from "../utils/logger";

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

  const abortRef = useRef<AbortController | null>(null);

  const loadData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    const { signal } = controller;
    const results = await Promise.allSettled([
      getRepos(signal),
      listTriggeredAlerts(false, 50, signal),
      listEarlySignals({ limit: 5, signal }),
      getSignalSummary(signal),
    ]);

    if (controller.signal.aborted) return;

    const [reposResult, alertsResult, signalsResult, summaryResult] = results;

    if (reposResult.status === "fulfilled") setRepos(reposResult.value.repos);
    if (alertsResult.status === "fulfilled") setAlerts(alertsResult.value);
    if (signalsResult.status === "fulfilled") setEarlySignals(signalsResult.value.signals);
    if (summaryResult.status === "fulfilled") setSignalSummary(summaryResult.value);

    const failures = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected" && !controller.signal.aborted
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

  useOnceEffect(() => {
    void loadData();
    return () => abortRef.current?.abort();
  });

  const handleAcknowledgeSignal = useCallback(async (signalId: number) => {
    try {
      await acknowledgeSignal(signalId);
      setEarlySignals((prev) => prev.filter((s) => s.id !== signalId));
      setSignalSummary((prev) =>
        prev ? { ...prev, total_active: Math.max(0, prev.total_active - 1) } : prev
      );
    } catch (err) {
      logger.warn("[useDashboard] 訊號確認失敗:", err);
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
