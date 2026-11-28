/**
 * 情境徽章，顯示 Hacker News 相關資訊。
 * 點擊徽章可展開顯示討論詳情。
 */

import { useState, useCallback } from "react";
import type { CSSProperties, MouseEvent } from "react";
import { skipToken, useQuery } from "@tanstack/react-query";
import { safeOpenUrl } from "../utils/url";
import { getContextSignals } from "../api/client";
import type { ContextBadge, ContextSignal } from "../api/client";
import { useI18n, interpolate } from "../i18n";
import { formatRelativeTime } from "../utils/format";
import { loadStatus, queryKeys } from "../lib/react-query";
import type { LoadStatus } from "../lib/react-query";
import { LoadError } from "./LoadError";

interface ContextBadgesProps {
  badges: ContextBadge[];
  repoId?: number;
}

const BADGE_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  hn: { icon: "🔶", label: "HN", color: "#ff6600" },
};

function formatValue(badge: ContextBadge): string {
  if (badge.type === "hn") {
    const match = badge.label.match(/(\d+)/);
    if (match) return match[1];
  }
  return badge.label;
}

function HnDiscussionPanel({
  signals,
  load,
}: {
  /** undefined＝還沒讀到。讀不到與「讀到了、沒有討論」是兩個狀態：後者才說暫無討論 */
  signals: ContextSignal[] | undefined;
  load: LoadStatus;
}) {
  const { t } = useI18n();

  const handleOpenUrl = async (e: MouseEvent, url: string) => {
    e.preventDefault();
    e.stopPropagation();
    await safeOpenUrl(url);
  };

  // 讀取狀態照 loadStatus：還沒讀到就失敗時說讀不到並給重試（重試中說明與按鈕留著，焦點不離開）；
  // 已經讀到、重讀失敗時保留列表，另外說沒有更新成功
  if (signals === undefined) {
    return (
      <div className="hn-panel">
        {load.failed ? (
          <LoadError
            message={t.contextBadges.loadFailed}
            onRetry={load.retry}
            isRetrying={load.inProgress}
          />
        ) : (
          <div className="hn-panel-loading">{t.repo.loadingBadges}</div>
        )}
      </div>
    );
  }

  return (
    <div className="hn-panel">
      {signals.length === 0 && (
        <div className="hn-panel-empty">{t.contextBadges.noDiscussions}</div>
      )}
      {signals.map((signal) => (
        <div key={signal.id} className="hn-discussion-item">
          <a
            href={signal.url}
            onClick={(e) => handleOpenUrl(e, signal.url)}
            className="hn-discussion-title"
          >
            {signal.title || t.contextBadges.untitled}
          </a>
          <div className="hn-discussion-meta">
            {signal.score != null && <span className="hn-meta-item">▲ {signal.score}</span>}
            {signal.comment_count != null && (
              <span className="hn-meta-item">💬 {signal.comment_count}</span>
            )}
            {signal.author && <span className="hn-meta-item hn-meta-author">{signal.author}</span>}
            {signal.published_at && (
              <span className="hn-meta-item">
                {formatRelativeTime(signal.published_at, { justNowText: t.relativeTime.justNow })}
              </span>
            )}
          </div>
        </div>
      ))}
      {load.failed && (
        <LoadError
          message={t.contextBadges.refreshFailed}
          onRetry={load.retry}
          isRetrying={load.inProgress}
        />
      )}
    </div>
  );
}

export function ContextBadges({ badges, repoId }: ContextBadgesProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  // 放在 repoCard 底下：invalidateTrackedRepos 會帶到（背景寫入 HN、抓取、全部重新整理之後徽章分數會變），
  // 展開中跟著重讀，收著只標過期、下次展開才重讀；沒有變化時，在全域的 staleTime 內再展開用讀過的那份。
  // 收起再展開沿用在途的那次；重讀打斷還沒回來的那次時，晚到的舊回應寫不進快取，只留最後送出的
  const query = useQuery<ContextSignal[], Error>({
    queryKey: queryKeys.repoCard.hnDiscussions(repoId ?? 0),
    queryFn:
      repoId === undefined
        ? skipToken
        : async () => (await getContextSignals(repoId, "hn")).signals,
    // 徽章沒了整塊不畫（見下方 return null），面板也看不到，不再跟著重讀
    enabled: expanded && badges.length > 0,
    // apiCall 對 GET 已經重試過，這裡再重試只會讓讀不到晚一倍才出現（同 useCategoryQueries）
    retry: false,
  });
  const load = loadStatus(query);

  const toggleExpand = useCallback(() => {
    if (!repoId) return;
    setExpanded((prev) => !prev);
  }, [repoId]);

  if (badges.length === 0) return null;

  return (
    <div className="context-badges-container">
      <div className="context-badges">
        {badges.map((badge) => {
          const config = BADGE_CONFIG[badge.type] || {
            icon: "❓",
            label: "?",
            color: "#666",
          };
          const tooltip = t.contextBadges.hnScore;
          const value = formatValue(badge);

          return (
            <button
              key={badge.url}
              type="button"
              className={`context-badge context-badge-${badge.type} ${badge.is_recent ? "recent" : ""} ${repoId ? "expandable" : ""}`}
              style={{ "--badge-color": config.color } as CSSProperties}
              // badge.label 由後端組成，本身已含前綴（例如 "HN: 528 pts"）。
              // 再前綴一次會得到 "Hacker News 討論分數: HN: 528 pts"，
              // 而 aria-label 會變成 "HN: HN: 528 pts"——螢幕閱讀器唸兩遍
              title={interpolate(t.contextBadges.tooltipWithLabel, {
                tooltip,
                label: badge.label,
              })}
              aria-label={badge.label}
              onClick={repoId ? toggleExpand : undefined}
            >
              <span className="badge-icon">{config.icon}</span>
              {config.label && <span className="badge-label">{config.label}</span>}
              <span className="badge-value">{value}</span>
              {repoId && <span className="badge-expand-arrow">{expanded ? "▾" : "▸"}</span>}
            </button>
          );
        })}
      </div>

      {expanded && <HnDiscussionPanel signals={query.data} load={load} />}
    </div>
  );
}
