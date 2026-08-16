/**
 * Dashboard 小工具自訂。
 * 允許使用者顯示/隱藏各個 Dashboard 區塊，設定持久化至 localStorage。
 */

import { memo, useState, useCallback, useRef } from "react";
import { useI18n } from "../../i18n";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useEscapeKey } from "../../hooks/useEscapeKey";

export type WidgetId =
  | "statsGrid"
  | "portfolioHealth"
  | "signalSpotlight"
  | "weeklySummary"
  | "portfolioHistory"
  | "velocityChart"
  | "languageDistribution"
  | "categorySummary"
  | "recentActivity";

export type WidgetVisibility = Record<WidgetId, boolean>;

// 版面的 widget 組成在 2026-08-16 的重設計中改變了，舊偏好對不上新版面。
// loadWidgetVisibility 用 {...DEFAULT, ...parsed}，已存的鍵會蓋過新預設值，
// 所以只改 DEFAULT_VISIBILITY 對「曾經打開過這個選單的人」完全沒有作用——
// 換一把新 key 才能讓新的預設值真的生效，重置是正確結果而不是損失。
const STORAGE_KEY = "starscope-dashboard-widgets-v2";

const DEFAULT_VISIBILITY: WidgetVisibility = {
  // 四張卡的數字已經各有去處（AttentionBar 的狀態列、MoversPanel 的標題），
  // 這一排改為預設關閉，但程式碼與開關都保留——留不留是使用者的判斷
  statsGrid: false,
  portfolioHealth: false,
  signalSpotlight: true,
  weeklySummary: true,
  portfolioHistory: false,
  velocityChart: false,
  languageDistribution: false,
  categorySummary: false,
  recentActivity: false,
};

export function loadWidgetVisibility(): WidgetVisibility {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VISIBILITY;
    const parsed = JSON.parse(raw) as Partial<WidgetVisibility>;
    return { ...DEFAULT_VISIBILITY, ...parsed };
  } catch {
    return DEFAULT_VISIBILITY;
  }
}

export function saveWidgetVisibility(visibility: WidgetVisibility): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(visibility));
  } catch {
    // localStorage 不可用時靜默失敗
  }
}

interface Props {
  visibility: WidgetVisibility;
  onChange: (visibility: WidgetVisibility) => void;
}

export const WidgetCustomizer = memo(function WidgetCustomizer({ visibility, onChange }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 點擊外部或 ESC 關閉
  useClickOutside(ref, () => setOpen(false), open);
  useEscapeKey(() => setOpen(false), open);

  const toggle = useCallback(
    (id: WidgetId) => {
      const next = { ...visibility, [id]: !visibility[id] };
      onChange(next);
      saveWidgetVisibility(next);
    },
    [visibility, onChange]
  );

  const widgets: { id: WidgetId; label: string }[] = [
    { id: "portfolioHealth", label: t.dashboard.healthScore.title },
    { id: "signalSpotlight", label: t.dashboard.signals.title },
    { id: "weeklySummary", label: t.dashboard.weekly.title },
    { id: "portfolioHistory", label: t.dashboard.portfolioHistory.title },
    { id: "velocityChart", label: t.dashboard.velocityDistribution },
    { id: "languageDistribution", label: t.dashboard.languageDistribution.title },
    { id: "categorySummary", label: t.dashboard.categorySummary.title },
    { id: "recentActivity", label: t.dashboard.recentActivity },
    // 加在最後：StatsGrid 剛拿到 widget key，開關要看得到，但不必打亂既有排序
    { id: "statsGrid", label: t.dashboard.stats.title },
  ];

  return (
    <div className="widget-customizer" ref={ref}>
      <button
        className="widget-customizer-btn"
        onClick={() => setOpen((o) => !o)}
        title={t.dashboard.widgetCustomizer.customize}
        aria-label={t.dashboard.widgetCustomizer.customize}
        aria-expanded={open}
      >
        ⚙
      </button>
      {open && (
        <div
          className="widget-customizer-dropdown"
          role="group"
          aria-label={t.dashboard.widgetCustomizer.title}
        >
          <div className="widget-customizer-title">{t.dashboard.widgetCustomizer.title}</div>
          {widgets.map(({ id, label }) => (
            <label key={id} className="widget-customizer-item">
              <input
                type="checkbox"
                checked={visibility[id]}
                onChange={() => toggle(id)}
                aria-label={label}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
});
