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

interface ProgressBarProps {
  progress: { phase: string; done: number; total: number } | null;
  copy: ReturnType<typeof useI18n>["t"]["settings"]["interests"]["trending"];
}

/**
 * 兩階段進度：取樣佔前 25%，查熱度佔後 75%（後者的請求數是前者的數倍，
 * 若平均分配會出現「前四分之一飛快、後面卡住」的錯覺）。
 * 還沒收到第一筆進度時顯示不確定狀態，而不是假裝在 0%。
 */
function TrendingProgressBar({ progress, copy }: ProgressBarProps) {
  const isSampling = progress?.phase === "sampling";
  const ratio = progress && progress.total > 0 ? progress.done / progress.total : 0;
  const percent = progress ? Math.round(isSampling ? ratio * 25 : 25 + ratio * 75) : null;

  return (
    <div className="trending-progress" data-testid="trending-progress">
      <div className="trending-progress-head">
        <span>
          {progress
            ? `${isSampling ? copy.phaseSampling : copy.phaseCounting} ${progress.done}/${progress.total}`
            : copy.refreshing}
        </span>
        {percent !== null && <span className="trending-progress-percent">{percent}%</span>}
      </div>
      <div
        className="trending-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-label={copy.refreshing}
      >
        <div
          className={`trending-progress-fill${percent === null ? " is-indeterminate" : ""}`}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function TrendingTopics({ onAdd }: TrendingTopicsProps) {
  const { t } = useI18n();
  const { topics, computedAt, isRefreshing, progress, refreshError, refresh } = useTrendingTopics();
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
            {isRefreshing ? copy.refreshingShort : copy.refresh}
          </button>
        </div>
      </div>

      {/* 重算期間不顯示這行：下方進度條已經說明狀態，重複只是雜訊 */}
      {!isRefreshing && (
        <p className="interest-trending-stamp">
          {computedAt ? `${copy.lastChecked} ${formatRelativeTime(computedAt)}` : copy.never}
        </p>
      )}

      {refreshError && (
        <p className="interest-trending-error" role="alert">
          {getErrorMessage(refreshError, copy.error)}
        </p>
      )}

      {isRefreshing ? (
        // 這是要跑一兩分鐘的操作。期間若只顯示一句靜態文字，使用者無法分辨
        // 「還在跑」與「卡住了」——實際發生過：按下去之後畫面正中央仍寫著
        // 空狀態提示，只有按鈕在轉，使用者傳截圖來問有沒有按到。
        <TrendingProgressBar progress={progress} copy={copy} />
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
