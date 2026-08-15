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
import { markFeedItemOpened } from "../../api/client";
import { formatNumber, formatRelativeTime } from "../../utils/format";
import { getLanguageColor } from "../../constants/languageColors";
import styles from "./Discovery.module.css";

interface FeedItemCardProps {
  item: FeedItem;
  isInWatchlist: boolean;
  onStar: (item: FeedItem) => void | Promise<void>;
  /** 已追蹤時按下按鈕：由呼叫端負責確認，因為這一下會改動 GitHub 帳號 */
  onUnstar: (item: FeedItem) => void;
  onDismiss: (item: FeedItem) => void;
}

/**
 * 命中詞的顯示格式：topic 是常態（使用者的興趣幾乎都是 topic），前綴只有噪音；
 * language / keyword 命中較罕見，保留前綴才知道「它是怎麼被撈進來的」。
 */
function displayMatchedTerm(matched: string): string {
  return matched.startsWith("topic:") ? matched.slice("topic:".length) : matched;
}

export function FeedItemCard({
  item,
  isInWatchlist,
  onStar,
  onUnstar,
  onDismiss,
}: FeedItemCardProps) {
  const { t } = useI18n();
  // 兩段鎖：starring 擋同一次請求的連點，isInWatchlist 擋「已經加成功之後再按」。
  // 少了任何一段，第二次 addRepo 都會回 400「已在追蹤清單」變成泛用錯誤 toast。
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
            // 先送統計訊號再開連結，但兩者互不等待：這是量測，不是功能。
            // 若 await 它，sidecar 沒回應時使用者的連結就跟著卡住；若讓它冒泡成
            // 錯誤，統計失敗會被誤讀成「連結壞了」。所以吞掉錯誤是刻意的。
            void markFeedItemOpened(item.id).catch(() => undefined);
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
            className={`${styles.addButton} ${isInWatchlist ? styles.inWatchlist : ""}`}
            data-testid={`feed-star-${item.id}`}
            disabled={starring}
            onClick={async () => {
              // 已追蹤時這顆是「取消」——鏡像模型下它實質上是 GitHub 的 star 開關。
              // 取消不在這裡直接執行：呼叫端會先確認，因為會改動公開帳號。
              if (isInWatchlist) {
                onUnstar(item);
                return;
              }
              setStarring(true);
              try {
                await onStar(item);
              } finally {
                setStarring(false);
              }
            }}
          >
            ⭐ {isInWatchlist ? t.discovery.inWatchlist : t.discovery.forYou.addToWatchlist}
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
