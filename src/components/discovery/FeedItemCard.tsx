/**
 * Feed 單卡：repo 資訊 + 推薦理由行 + 回饋動作。
 */
import { useState } from "react";
import { useI18n } from "../../i18n";
import type { FeedItem } from "../../api/types";
import { StarIcon, ForkIcon, LinkExternalIcon } from "../Icons";
import { safeOpenUrl } from "../../utils/url";
import { formatNumber, formatRelativeTime } from "../../utils/format";
import { getLanguageColor } from "../../constants/languageColors";
import styles from "./Discovery.module.css";

interface FeedItemCardProps {
  item: FeedItem;
  onStar: (item: FeedItem) => void | Promise<void>;
  onDismiss: (item: FeedItem) => void;
}

export function FeedItemCard({ item, onStar, onDismiss }: FeedItemCardProps) {
  const { t } = useI18n();
  // 追蹤中鎖住按鈕：連點會送出兩次 addRepo，第二次回 400「已在追蹤清單」，
  // 使用者會同時看到成功與失敗兩個 toast。
  const [starring, setStarring] = useState(false);
  const reason = t.discovery.forYou.reason;
  const reasonParts = [
    item.reason.matched.join(", "),
    `${item.reason.stars.toLocaleString()} ${reason.stars}`,
    item.reason.age_days !== null ? `${item.reason.age_days} ${reason.daysOld}` : null,
  ].filter(Boolean);

  return (
    <article className={styles.resultCard} data-testid={`feed-item-${item.id}`}>
      <div className={styles.cardHeader}>
        <a
          href={item.url}
          className={styles.repoName}
          onClick={(e) => {
            e.preventDefault();
            void safeOpenUrl(item.url);
          }}
        >
          {item.full_name}
          <LinkExternalIcon size={14} className={styles.externalIcon} />
        </a>
        <button
          className={styles.addButton}
          data-testid={`feed-star-${item.id}`}
          disabled={starring}
          onClick={async () => {
            setStarring(true);
            try {
              await onStar(item);
            } finally {
              setStarring(false);
            }
          }}
        >
          ⭐ {t.discovery.forYou.addToWatchlist}
        </button>
      </div>

      {item.description && <p className={styles.description}>{item.description}</p>}

      <div className={styles.cardMeta}>
        {item.language && (
          <span className={styles.language}>
            <span
              className={styles.languageDot}
              style={{ backgroundColor: getLanguageColor(item.language) }}
            />
            {item.language}
          </span>
        )}
        <span className={styles.stat}>
          <StarIcon size={14} />
          {formatNumber(item.stars)}
        </span>
        <span className={styles.stat}>
          <ForkIcon size={14} />
          {formatNumber(item.forks)}
        </span>
        {/* 放在 meta 列而非推薦理由行：這是 repo 本身的事實，而且是判斷「還活著嗎」的主要依據 */}
        {item.reason.pushed_at && (
          <span className={styles.stat} data-testid={`feed-pushed-${item.id}`}>
            {t.discovery.forYou.lastPush} {formatRelativeTime(item.reason.pushed_at)}
          </span>
        )}
      </div>

      <p className={styles.feedReason} data-testid={`feed-reason-${item.id}`}>
        {reasonParts.join(" · ")}
      </p>

      <div className={styles.feedActions}>
        <button
          className={styles.dismissButton}
          data-testid={`feed-dismiss-${item.id}`}
          onClick={() => onDismiss(item)}
        >
          🚫 {t.discovery.forYou.dismiss}
        </button>
      </div>
    </article>
  );
}
