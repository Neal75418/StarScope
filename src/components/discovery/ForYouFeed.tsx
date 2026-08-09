/**
 * For You feed 清單：Discovery 頁預設畫面。
 */
import { useI18n } from "../../i18n";
import { useFeed } from "../../hooks/useFeed";
import { useInterests } from "../../hooks/useInterests";
import type { FeedItem } from "../../api/types";
import { FeedItemCard } from "./FeedItemCard";
import { Skeleton } from "../Skeleton";
import styles from "./Discovery.module.css";

interface ForYouFeedProps {
  onAddToWatchlist: (item: FeedItem) => Promise<boolean>;
}

export function ForYouFeed({ onAddToWatchlist }: ForYouFeedProps) {
  const { t } = useI18n();
  const { items, feedDate, isLoading, isGenerating, feedback, refresh } = useFeed();
  const { interests } = useInterests();
  const hasInterests = interests.length > 0;

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

  // 重試只在「有興趣清單但當日尚未成功產生」時才有意義：
  // 已有內容時後端冪等會直接回傳既有數量；興趣清單為空時 generate_feed 會立刻 return 0
  // （feed_generator.py 的 `if not interests: return 0`），兩種情況按了都不會有任何變化。
  // 且無謂重試會對每個興趣各打一次 GitHub search，吃掉 Discovery 搜尋共用的配額。
  if (items.length === 0) {
    return (
      <div className={styles.emptyState} data-testid="feed-empty-state">
        <p>{t.discovery.forYou.empty}</p>
        {hasInterests && (
          <button className={styles.selectionToggle} onClick={refresh} data-testid="feed-retry">
            {t.discovery.forYou.refresh}
          </button>
        )}
      </div>
    );
  }

  const visible = items.filter((item) => item.feedback !== "dismissed");

  return (
    <div className={styles.recSection} data-testid="for-you-feed">
      <div className={styles.recSectionHeader}>
        <div>
          <h3>{t.discovery.forYou.title}</h3>
          <p className={styles.recSubtitle}>
            {t.discovery.forYou.subtitle}
            {feedDate && <span data-testid="feed-date"> · {feedDate}</span>}
          </p>
        </div>
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
