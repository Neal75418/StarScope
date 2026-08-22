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
  listAlertRules,
  acknowledgeSignal,
  RepoWithSignals,
  TriggeredAlert,
  AlertRule,
} from "../api/client";
import type { EarlySignal } from "../api/types";
import { ALERT_FETCH_LIMIT } from "../constants/api";
import { queryKeys } from "../lib/react-query";
import { logger } from "../utils/logger";
import { computeMovers, type MoversResult } from "../utils/movers";
import type { LanguageSlice } from "../components/dashboard/LanguageDistribution";
import type { AttentionItem } from "../components/dashboard/AttentionBar";
import { useWeeklySummary } from "./useWeeklySummary";

const EMPTY_REPOS: RepoWithSignals[] = [];
const EMPTY_ALERTS: TriggeredAlert[] = [];
const EMPTY_SIGNALS: EarlySignal[] = [];
const EMPTY_ALERT_RULES: AlertRule[] = [];

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

  // 供段一（AttentionBar）判斷 hasAlertRules。這裡沒有獨立的「已檢查」旗標可用
  // （不像 weekly 有 releasesChecked），所以規則是否載完必須併進整體 isLoading，
  // 不然頁面會在規則資料還沒到的那一瞬間，把「還沒查」誤顯示成「沒有規則」。
  const alertRulesQuery = useQuery<AlertRule[], Error>({
    queryKey: queryKeys.alerts.rules(),
    queryFn: () => listAlertRules(),
  });

  // 週報摘要獨立於整體 isLoading 之外：releasesChecked 就是特地為了不讓
  // 這一頁的其餘部分等它而設計的旗標，見下方 attentionItems。
  const { data: weekly } = useWeeklySummary();

  const repos = reposQuery.data ?? EMPTY_REPOS;
  const alerts = alertsQuery.data ?? EMPTY_ALERTS;
  const earlySignals = signalsQuery.data ?? EMPTY_SIGNALS;
  const signalSummary = summaryQuery.data ?? null;
  const alertRules = alertRulesQuery.data ?? EMPTY_ALERT_RULES;
  const isLoading =
    reposQuery.isLoading ||
    alertsQuery.isLoading ||
    signalsQuery.isLoading ||
    summaryQuery.isLoading ||
    alertRulesQuery.isLoading;

  // 合併錯誤訊息
  const error = useMemo(() => {
    const errors = [
      reposQuery.error,
      alertsQuery.error,
      signalsQuery.error,
      summaryQuery.error,
      alertRulesQuery.error,
    ]
      .filter((e): e is Error => e instanceof Error)
      .map((e) => e.message);
    return errors.length > 0 ? errors.join("; ") : null;
  }, [
    reposQuery.error,
    alertsQuery.error,
    signalsQuery.error,
    summaryQuery.error,
    alertRulesQuery.error,
  ]);

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

  // 段二：「在動」排行，運算全交給 computeMovers（挑窗口、算相對成長、算門檻）
  const movers: MoversResult = useMemo(() => computeMovers(repos), [repos]);

  // 段一：只收「值得打斷你」的。deprecation 單獨出現不算，那是預告不是行動——
  // 它仍然會以 tag 的身分出現在下面段三的版本清單，只是不會被搬進這裡打斷使用者。
  const attentionItems: AttentionItem[] = useMemo(() => {
    // id 不能用 kind-title 湊：一條全域規則（repo_id=null）對每個觸發的 repo
    // 各寫一筆 TriggeredAlert，rule_name 因此完全相同，湊出來的 key 會重複，
    // React 可能在重新渲染後把某一列的 detail 錯配到另一個 repo 上。alert 自己的
    // DB 主鍵（a.id）本來就唯一，直接用；release 沒有獨立主鍵可用，退而求其次
    // 用 repo_id + title——真正的碰撞（同一頁上兩個不同 repo）已經被 repo_id 擋掉。
    const fromAlerts: AttentionItem[] = alerts
      .filter((a) => !a.acknowledged)
      .map((a) => ({
        id: `alert-${a.id}`,
        kind: "alert" as const,
        title: a.rule_name,
        detail: a.repo_name,
      }));

    const fromReleases: AttentionItem[] = (weekly?.releases ?? [])
      .filter((r) => r.tags.some((tag) => tag === "breaking" || tag === "security"))
      .map((r) => ({
        id: `release-${r.repo_id}-${r.title}`,
        kind: "release" as const,
        title: `${r.repo_name} ${r.title}`,
        // 走 i18n 而不是直接印原始 tag：同一份標記在下方的「新版本」面板顯示成
        // 「破壞性變更」，段一若印 "breaking"，同一頁上同一件事會有兩種語言
        detail: r.tags
          .map(
            (tag) =>
              t.dashboard.weekly.releaseTags[tag as keyof typeof t.dashboard.weekly.releaseTags] ??
              tag
          )
          .join(" · "),
        url: r.url,
      }));

    return [...fromAlerts, ...fromReleases];
  }, [alerts, weekly, t]);

  // 一條警報規則都沒有時，「alert」這個來源永遠不會有東西可以收進 attentionItems，
  // AttentionBar 必須把這件事講出來，而不是讓沒有規則看起來跟「規則都沒觸發」一樣。
  const hasAlertRules = alertRules.length > 0;
  // weekly !== undefined 只代表「HTTP 呼叫回來了」，不代表「版本真的抓過」——
  // _get_releases 找不到資料時一律回 []，抓取器從沒跑過跟跑過但這週沒有版本
  // 兩種情況在這裡長得一模一樣。後端另外用 releases_ever_fetched 明講「有沒有
  // 至少成功抓過一次」，AttentionBar 要看的是這個旗標，不是 weekly 本身是否有值。
  const releasesChecked = weekly?.releases_ever_fetched ?? false;

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
    earlySignals: spotlightSignals,
    signalSummary,
    movers,
    attentionItems,
    hasAlertRules,
    releasesChecked,
    acknowledgeSignal: handleAcknowledgeSignal,
    isLoading,
    isFetching: reposQuery.isFetching || alertsQuery.isFetching,
    dataUpdatedAt: reposQuery.dataUpdatedAt,
    error,
    refresh,
  };
}
