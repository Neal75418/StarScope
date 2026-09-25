/**
 * 段一：自上次以來。取代 AttentionBar。
 *
 * 必須經常是空的——每天都亮的東西等於壁紙，所以一般 release 收在「其他更新」。
 * 而空的時候不能只說「沒事」：這是整頁唯一「你可以不看」的承諾，
 * 載入中、release 從未抓過、API 失敗時都不能宣稱沒事。
 */
import { memo, useState } from "react";
import type { DigestItem, DigestResponse } from "../../api/client";
import { useI18n, interpolate } from "../../i18n";
import { describeDigestItem } from "../../utils/digestCopy";
import { formatRelativeTime } from "../../utils/format";
import { safeOpenUrl } from "../../utils/url";

interface DigestPanelProps {
  digest: DigestResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  appendFailed: boolean;
  onRetry: () => void;
  totalRepos: number;
  hasAlertRules: boolean;
  updatedLabel: string;
  isRefreshing: boolean;
  onRefresh: () => void;
}

function DigestRow({ item }: { item: DigestItem }) {
  const { t } = useI18n();
  const { icon, summary } = describeDigestItem(item, t);
  const target = item.url ?? item.repo.url;
  return (
    <li className="digest-item" data-testid="digest-item">
      <span className="digest-item-icon" aria-hidden="true">
        {icon}
      </span>
      <a
        href={target}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.preventDefault();
          void safeOpenUrl(target);
        }}
      >
        {item.repo.full_name}
      </a>
      <span className="digest-item-summary">{summary}</span>
      <span className="digest-item-time">{formatRelativeTime(item.occurred_at)}</span>
    </li>
  );
}

export const DigestPanel = memo(function DigestPanel({
  digest,
  isLoading,
  isError,
  appendFailed,
  onRetry,
  totalRepos,
  hasAlertRules,
  updatedLabel,
  isRefreshing,
  onRefresh,
}: DigestPanelProps) {
  const { t } = useI18n();
  const copy = t.dashboard.digest;
  const [othersOpen, setOthersOpen] = useState(false);

  const highlights = digest?.items.filter((i) => i.tier === "highlight") ?? [];
  const others = digest?.items.filter((i) => i.tier === "other") ?? [];
  const since = digest?.last_seen_at
    ? interpolate(copy.lastSeen, { time: formatRelativeTime(digest.last_seen_at) })
    : copy.firstVisit;

  let status: string;
  if (isError) status = copy.loadFailed;
  else if (isLoading || !digest) status = "";
  else if (!digest.releases_checked && highlights.length === 0) status = copy.checking;
  else if (highlights.length > 0) status = interpolate(copy.title, { count: highlights.length });
  else status = hasAlertRules ? copy.none : `${copy.none} · ${copy.noAlertRules}`;

  return (
    <section className="digest-panel" data-testid="digest-panel" aria-busy={isLoading}>
      <div className="digest-status">
        <span className="digest-status-text">
          {isLoading ? <span className="skeleton skeleton-text" /> : status}
        </span>
        {digest && !isError && <span className="digest-status-since">{since}</span>}
        {isError && (
          <button
            type="button"
            className="digest-retry"
            data-testid="digest-retry"
            onClick={onRetry}
          >
            {copy.retry}
          </button>
        )}
        <span className="digest-status-meta">
          {interpolate(t.dashboard.attention.tracking, { count: totalRepos })} ·{" "}
          {isRefreshing ? t.dashboard.attention.fetching : updatedLabel}
        </span>
        <button
          type="button"
          className="digest-refresh"
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-busy={isRefreshing}
          aria-label={t.common.refresh}
        >
          ↻
        </button>
      </div>
      {appendFailed && <p className="digest-append-failed">{copy.appendFailed}</p>}
      {highlights.length > 0 && (
        <ul className="digest-list">
          {highlights.map((item) => (
            <DigestRow key={item.key} item={item} />
          ))}
        </ul>
      )}
      {digest && digest.other_total > 0 && (
        <div className="digest-others">
          <button
            type="button"
            className="digest-others-toggle"
            data-testid="digest-others-toggle"
            aria-expanded={othersOpen}
            onClick={() => setOthersOpen((open) => !open)}
          >
            {othersOpen ? "▾" : "▸"} {interpolate(copy.others, { count: digest.other_total })}
          </button>
          {othersOpen && (
            <ul className="digest-list digest-list--others">
              {others.map((item) => (
                <DigestRow key={item.key} item={item} />
              ))}
              {digest.other_total > others.length && (
                <li className="digest-more">
                  {interpolate(copy.moreOthers, { count: digest.other_total - others.length })}
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </section>
  );
});
