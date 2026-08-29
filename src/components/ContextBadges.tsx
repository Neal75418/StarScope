/**
 * 情境徽章，顯示 Hacker News 相關資訊。
 * 點擊徽章可展開顯示討論詳情。
 */

import { useState, useCallback, useRef } from "react";
import type { CSSProperties, MouseEvent } from "react";
import { safeOpenUrl } from "../utils/url";
import { getContextSignals } from "../api/client";
import type { ContextBadge, ContextSignal } from "../api/client";
import { useI18n, interpolate } from "../i18n";
import { formatRelativeTime } from "../utils/format";
import { logger } from "../utils/logger";

interface ContextBadgesProps {
  badges: ContextBadge[];
  repoId?: number;
}

interface PanelState {
  expanded: boolean;
  signals: ContextSignal[];
  loading: boolean;
  fetched: boolean;
  /** 抓取失敗。與「fetched 且 signals 為空」必須是兩個狀態：後者才是「暫無討論」 */
  error: boolean;
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
  loading,
  error,
  onRetry,
}: {
  signals: ContextSignal[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const { t } = useI18n();

  const handleOpenUrl = async (e: MouseEvent, url: string) => {
    e.preventDefault();
    e.stopPropagation();
    await safeOpenUrl(url);
  };

  if (loading) {
    return (
      <div className="hn-panel">
        <div className="hn-panel-loading">{t.repo.loadingBadges}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="hn-panel">
        <div className="hn-panel-empty" role="alert">
          {t.contextBadges.loadFailed}{" "}
          <button type="button" className="hn-panel-retry" onClick={onRetry}>
            {t.contextBadges.retry}
          </button>
        </div>
      </div>
    );
  }

  if (signals.length === 0) {
    return (
      <div className="hn-panel">
        <div className="hn-panel-empty">{t.contextBadges.noDiscussions}</div>
      </div>
    );
  }

  return (
    <div className="hn-panel">
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
    </div>
  );
}

export function ContextBadges({ badges, repoId }: ContextBadgesProps) {
  const { t } = useI18n();
  const [panelState, setPanelState] = useState<PanelState>({
    expanded: false,
    signals: [],
    loading: false,
    fetched: false,
    error: false,
  });

  // 只有最新一次請求有權寫入 panelState：展開→收合→再展開會產生兩個
  // 在途請求，若舊請求最後落地，它的失敗會蓋在新請求的成功資料上
  const fetchSeqRef = useRef(0);

  const fetchSignals = useCallback(async () => {
    if (!repoId) return;
    const seq = ++fetchSeqRef.current;
    setPanelState((prev) => ({ ...prev, loading: true, error: false }));
    try {
      const res = await getContextSignals(repoId, "hn");
      if (seq !== fetchSeqRef.current) return;
      setPanelState((prev) => ({
        ...prev,
        signals: res.signals,
        loading: false,
        fetched: true,
        error: false,
      }));
    } catch (err) {
      logger.warn("[ContextBadges] 上下文訊號抓取失敗:", err);
      if (seq !== fetchSeqRef.current) return;
      // fetched 保持 false：收起再展開會自動重試。先前這裡設 fetched: true
      // 且清空 signals——徽章明明寫著 528 pts，點開卻說「暫無討論」，
      // 而且此生不再重打（第三方審查發現）。錯誤與「真的沒有」是兩個狀態。
      setPanelState((prev) => ({ ...prev, loading: false, error: true }));
    }
  }, [repoId]);

  const toggleExpand = useCallback(async () => {
    if (!repoId) return;

    if (!panelState.expanded && !panelState.fetched) {
      void fetchSignals();
    }
    setPanelState((prev) => ({ ...prev, expanded: !prev.expanded }));
  }, [panelState.expanded, panelState.fetched, repoId, fetchSignals]);

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
              {repoId && (
                <span className="badge-expand-arrow">{panelState.expanded ? "▾" : "▸"}</span>
              )}
            </button>
          );
        })}
      </div>

      {panelState.expanded && (
        <HnDiscussionPanel
          signals={panelState.signals}
          loading={panelState.loading}
          error={panelState.error}
          onRetry={fetchSignals}
        />
      )}
    </div>
  );
}
