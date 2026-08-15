/**
 * 「正在升溫的主題」建議。
 *
 * 為什麼是手動更新而不是自動：主題趨勢以週為單位變動，實測同一天內重複取樣
 * 結果完全相同，所以每日自動重算多半在重算同一份答案，卻要吃掉與 feed 產生、
 * 探索搜尋共用的每分鐘 30 次搜尋配額。顯示「上次查詢時間」讓使用者自己判斷。
 *
 * 為什麼把三個數字都攤開：比值只是排序訊號，不是精確指標——實測 31 vs 30
 * 這種差距在取樣雜訊內，換一種取樣就會翻轉。攤開讓使用者自己判斷，
 * 比給一個看似權威的名次誠實。
 */
import { useI18n } from "../../i18n";
import { useTrendingTopics } from "../../hooks/useTrendingTopics";
import { formatRelativeTime } from "../../utils/format";
import { getErrorMessage } from "../../utils/error";

interface TrendingTopicsProps {
  /** 加入興趣清單；回傳是否成功 */
  onAdd: (topic: string) => Promise<boolean>;
}

export function TrendingTopics({ onAdd }: TrendingTopicsProps) {
  const { t } = useI18n();
  const { topics, computedAt, isRefreshing, refreshError, refresh } = useTrendingTopics();
  const copy = t.settings.interests.trending;

  return (
    <div className="interest-trending" data-testid="trending-topics">
      <div className="settings-section-header">
        <div>
          <h3>{copy.title}</h3>
          <p className="settings-description">{copy.subtitle}</p>
        </div>
        <div className="settings-section-actions">
          <button
            className="btn"
            data-testid="trending-refresh-btn"
            disabled={isRefreshing}
            onClick={() => void refresh().catch(() => undefined)}
          >
            {isRefreshing ? copy.refreshing : copy.refresh}
          </button>
        </div>
      </div>

      <p className="interest-trending-stamp">
        {isRefreshing
          ? copy.refreshing
          : computedAt
            ? `${copy.lastChecked} ${formatRelativeTime(computedAt)}`
            : copy.never}
      </p>

      {refreshError && (
        <p className="interest-trending-error" role="alert">
          {getErrorMessage(refreshError, copy.error)}
        </p>
      )}

      {isRefreshing && topics.length === 0 ? (
        // 這是要跑一兩分鐘的操作。期間若還顯示「尚未查詢過」，使用者會以為沒按到
        // ——實際發生過：按下去之後畫面正中央仍寫著空狀態提示，只有按鈕在轉。
        <p className="interest-empty" data-testid="trending-progress">
          {copy.refreshing}
        </p>
      ) : topics.length === 0 ? (
        <p className="interest-empty">{copy.empty}</p>
      ) : (
        <ul className="interest-trending-list">
          {topics.map((item) => (
            <li key={item.topic} className="interest-trending-item">
              <div className="interest-trending-info">
                <span className="interest-term">{item.topic}</span>
                <span className="interest-meta">
                  {item.sample_count} {copy.sampleLabel} · {item.global_count.toLocaleString()}{" "}
                  total
                </span>
              </div>
              <button
                className="btn btn-sm"
                data-testid={`trending-add-${item.topic}`}
                disabled={item.already_added}
                aria-label={`${copy.addThis}: ${item.topic}`}
                onClick={() => void onAdd(item.topic)}
              >
                {item.already_added ? copy.added : "+"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
