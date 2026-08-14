/**
 * Feed 單卡。資訊分層的職責（改動前先讀）：
 *
 * - 標題列：repo 名稱 + 全部動作（dismiss 與 track 集中右上，決策區只有一處）
 * - meta 列：repo 本身的事實——語言、星數、fork、最近更新、建立時間。
 *   「新專案＋還活著」要能在同一行讀完
 * - 理由行：只放「命中了哪些興趣詞」。星數/年齡不再重複出現在這裡——
 *   同一個數字在卡片上出現兩次是雜訊，不是強調
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

/**
 * 命中詞的顯示格式：topic 是常態（使用者的興趣幾乎都是 topic），前綴只有噪音；
 * language / keyword 命中較罕見，保留前綴才知道「它是怎麼被撈進來的」。
 */
function displayMatchedTerm(matched: string): string {
  return matched.startsWith("topic:") ? matched.slice("topic:".length) : matched;
}

export function FeedItemCard({ item, onStar, onDismiss }: FeedItemCardProps) {
  const { t } = useI18n();
  // 追蹤中鎖住按鈕：連點會送出兩次 addRepo，第二次回 400「已在追蹤清單」，
  // 使用者會同時看到成功與失敗兩個 toast。
  const [starring, setStarring] = useState(false);
  const reason = t.discovery.forYou.reason;

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
        <div className={styles.cardHeaderActions}>
          <button
            className={styles.dismissButton}
            data-testid={`feed-dismiss-${item.id}`}
            onClick={() => onDismiss(item)}
          >
            🚫 {t.discovery.forYou.dismiss}
          </button>
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
        {item.reason.pushed_at && (
          <span className={styles.stat} data-testid={`feed-pushed-${item.id}`}>
            {t.discovery.forYou.lastPush} {formatRelativeTime(item.reason.pushed_at)}
          </span>
        )}
        {item.reason.age_days !== null && (
          <span className={styles.stat} data-testid={`feed-age-${item.id}`}>
            {item.reason.age_days === 0
              ? reason.createdToday
              : `${item.reason.age_days} ${reason.daysOld}`}
          </span>
        )}
      </div>

      {item.reason.matched.length > 0 && (
        <p className={styles.feedReason} data-testid={`feed-reason-${item.id}`}>
          {reason.matched}
          {item.reason.matched.map(displayMatchedTerm).join(" · ")}
        </p>
      )}
    </article>
  );
}
