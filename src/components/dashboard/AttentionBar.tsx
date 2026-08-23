/**
 * 段一：需要注意。
 *
 * 必須經常是空的——每天都亮的警示等於壁紙。而空的時候不能只說「沒事」：
 * 這是整頁唯一一個「你可以不看」的承諾，宣稱沒事之前得先確定檢查跑得起來。
 */
import { memo } from "react";
import { useI18n, interpolate } from "../../i18n";
import { safeOpenUrl } from "../../utils/url";

export interface AttentionItem {
  /**
   * 穩定且唯一的識別碼，跟 title 分開存在——title 不保證唯一：一條全域警報規則
   * （repo_id=null）對每個觸發的 repo 各寫一筆，rule_name 因此會重複。React 用
   * key 對位重用 DOM，key 撞在一起時同一列可能在重新渲染後留著上一輪的 detail，
   * 在整頁唯一的行動區塊裡點名錯 repo。
   */
  id: string;
  kind: "alert" | "release";
  title: string;
  detail: string;
  url?: string;
}

interface AttentionBarProps {
  items: AttentionItem[];
  totalRepos: number;
  /** 一條規則都沒有時，警報那個來源永遠不會觸發，空狀態要講出來 */
  hasAlertRules: boolean;
  /** 版本尚未抓取時不能說「沒事」，只能說還在檢查 */
  releasesChecked: boolean;
  updatedLabel: string;
  /**
   * 抓取進行中。搬離 DataFreshnessBar 時這個回饋掉了——舊元件會顯示「同步中」
   * 並把按鈕藏起來，而抓取 94 個 repo 要好幾秒，沒有回饋的話按鈕與壞掉無法區分。
   */
  isRefreshing: boolean;
  /** 真的去 GitHub 抓（POST /repos/fetch-all），不是重讀本機快取 */
  onRefresh: () => void;
}

export const AttentionBar = memo(function AttentionBar({
  items,
  totalRepos,
  hasAlertRules,
  releasesChecked,
  updatedLabel,
  isRefreshing,
  onRefresh,
}: AttentionBarProps) {
  const { t } = useI18n();
  const copy = t.dashboard.attention;

  // 兩個檢查各自獨立：版本沒抓到就不能說「沒事」，而沒設規則是另一件要講的事。
  // 用三元短路的話，兩者同時發生時只會講其中一個，使用者會以為補上另一半就全覆蓋了。
  const base = releasesChecked ? copy.clear : copy.checking;
  const status = hasAlertRules ? base : `${base} · ${copy.noAlertRules}`;

  return (
    <section className="attention-bar" data-testid="attention-bar">
      <div className="attention-status">
        <span className="attention-status-text">{items.length > 0 ? copy.title : status}</span>
        <span className="attention-status-meta">
          {interpolate(copy.tracking, { count: totalRepos })} ·{" "}
          {isRefreshing ? copy.fetching : updatedLabel}
        </span>
        <button
          type="button"
          className="attention-refresh"
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-busy={isRefreshing}
          aria-label={t.common.refresh}
        >
          ↻
        </button>
      </div>
      {items.length > 0 && (
        <ul className="attention-list">
          {items.map((item) => (
            <li key={item.id} className="attention-item" data-testid="attention-item">
              {item.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    e.preventDefault();
                    void safeOpenUrl(item.url as string);
                  }}
                >
                  {item.title}
                </a>
              ) : (
                <span>{item.title}</span>
              )}
              <span className="attention-item-detail">{item.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
});
