/**
 * Hook for managing dashboard state and statistics.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getRepos, listTriggeredAlerts, RepoWithSignals, TriggeredAlert } from "../api/client";

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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Prevent duplicate fetches from StrictMode
  const hasFetchedRef = useRef(false);

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [reposResponse, alertsResponse] = await Promise.all([
        getRepos(),
        listTriggeredAlerts(false), // Get unacknowledged alerts
      ]);

      setRepos(reposResponse.repos);
      setAlerts(alertsResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard data");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    void loadData();
  }, [loadData]);

  // Compute statistics from repos data
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

  // Generate recent activity from repos and alerts
  const recentActivity: RecentActivity[] = useMemo(() => {
    const activities: RecentActivity[] = [];

    // Add all repos as activities
    for (const repo of repos) {
      activities.push({
        id: `repo-${repo.id}`,
        type: "repo_added",
        title: repo.full_name,
        description: repo.description ?? "",
        timestamp: repo.added_at,
      });
    }

    // Add all alerts as activities
    for (const alert of alerts) {
      activities.push({
        id: `alert-${alert.id}`,
        type: "alert_triggered",
        title: alert.rule_name,
        description: `${alert.repo_name}: ${alert.signal_type} ${alert.operator} ${alert.threshold}`,
        timestamp: alert.triggered_at,
      });
    }

    // Sort all activities by timestamp and return top 10
    return activities
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 10);
  }, [repos, alerts]);

  // Compute velocity distribution for chart
  const velocityDistribution = useMemo(() => {
    const ranges = [
      { label: "< 0", min: -Infinity, max: 0, inclusive: false },
      { label: "0-10", min: 0, max: 10, inclusive: false },
      { label: "10-50", min: 10, max: 50, inclusive: false },
      { label: "50-100", min: 50, max: 100, inclusive: false },
      { label: "100+", min: 100, max: Infinity, inclusive: true },
    ];

    return ranges.map((range) => ({
      label: range.label,
      count: repos.filter((r) => {
        const v = r.velocity ?? 0;
        // Use inclusive upper bound for the last range
        return v >= range.min && (range.inclusive ? v <= range.max : v < range.max);
      }).length,
    }));
  }, [repos]);

  return {
    stats,
    recentActivity,
    velocityDistribution,
    isLoading,
    error,
    refresh: loadData,
  };
}
