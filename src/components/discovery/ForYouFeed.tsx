/**
 * For You feed 清單：Discovery 頁預設畫面。
 */
import { useI18n } from "../../i18n";
import { useFeed } from "../../hooks/useFeed";
import type { FeedItem } from "../../api/types";
import { FeedItemCard } from "./FeedItemCard";
import { Skeleton } from "../Skeleton";
import styles from "./Discovery.module.css";

interface ForYouFeedProps {
  onAddToWatchlist: (item: FeedItem) => Promise<boolean>;
}

export function ForYouFeed({ onAddToWatchlist }: ForYouFeedProps) {
  const { t } = useI18n();
  const { items, isLoading, isGenerating, feedback, refresh } = useFeed();

  if (isLoading) {
    return (
      <div className={styles.recSection} data-testid="for-you-feed">
        {isGenerating && <p className={styles.recSubtitle}>{t.discovery.forYou.generating}</p>}
        <Skeleton width="70%" height={16} style={{ marginBottom: 8 }} />
        <Skeleton width="100%" height={12} style={{ marginBottom: 12 }} />
        <Skeleton width="60%" height={14} />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={styles.emptyState} data-testid="feed-empty-state">
        <p>{t.discovery.forYou.empty}</p>
      </div>
    );
  }

  const visible = items.filter((item) => item.feedback !== "dismissed");

  return (
    <div className={styles.recSection} data-testid="for-you-feed">
      <div className={styles.recSectionHeader}>
        <div>
          <h3>{t.discovery.forYou.title}</h3>
          <p className={styles.recSubtitle}>{t.discovery.forYou.subtitle}</p>
        </div>
        <button className={styles.selectionToggle} onClick={refresh}>
          {t.discovery.forYou.refresh}
        </button>
      </div>
      {visible.length === 0 ? (
        <p className={styles.recSubtitle} data-testid="feed-all-dismissed">
          {t.discovery.forYou.allDismissed}
        </p>
      ) : (
        <div className={styles.resultsList}>
          {visible.map((item) => (
            <FeedItemCard
              key={item.id}
              item={item}
              onStar={async (it) => {
                // 只有加入 watchlist 成功才送出 starred feedback，避免失敗仍污染回饋訊號
                const success = await onAddToWatchlist(it);
                if (success) {
                  feedback(it.id, "starred");
                }
              }}
              onDismiss={(it) => feedback(it.id, "dismissed")}
            />
          ))}
        </div>
      )}
    </div>
  );
}
