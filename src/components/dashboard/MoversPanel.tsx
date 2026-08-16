/**
 * 段二下層：相對成長排行。
 *
 * 永遠顯示前幾名，但在中位數 ×10 的位置畫一條線——線下的不假裝值得看。
 * 標題一定要帶窗口：這一頁已經有過一次「兩個同名而規則不同的數字」的教訓。
 */
import { memo } from "react";
import { useI18n, interpolate } from "../../i18n";
import { formatDelta } from "../../utils/format";
import type { Mover, MoversResult } from "../../utils/movers";

function formatPercent(relative: number): string {
  return `${relative > 0 ? "+" : ""}${(relative * 100).toFixed(2)}%`;
}

const MoverRow = memo(function MoverRow({ mover }: { mover: Mover }) {
  return (
    <div className="mover-row" data-testid="mover-row">
      <span className="mover-name">{mover.repo.full_name}</span>
      <span
        className={`mover-relative ${mover.relative > 0 ? "mover-relative--up" : "mover-relative--down"}`}
      >
        {formatPercent(mover.relative)}
      </span>
      <span className="mover-delta">{formatDelta(mover.delta)}</span>
    </div>
  );
});

export const MoversPanel = memo(function MoversPanel({ result }: { result: MoversResult }) {
  const { t } = useI18n();
  const copy = t.dashboard.movers;

  if (result.window === null) {
    return (
      <section className="dashboard-section movers-panel">
        <h3>{copy.title}</h3>
        <div className="weekly-empty" data-testid="movers-empty">
          {copy.empty}
        </div>
      </section>
    );
  }

  const windowLabel = result.window === 7 ? copy.window7 : copy.window1;
  // 拆成區域變數而不是直接在 filter 裡用 result.threshold!：
  // narrowing 不會穿過閉包作用在物件屬性上，拆出來的區域變數才會被 TS 記住非 null
  const { threshold } = result;
  const above =
    threshold === null ? result.risers : result.risers.filter((m) => m.relative >= threshold);
  const below = threshold === null ? [] : result.risers.filter((m) => m.relative < threshold);

  return (
    <section className="dashboard-section movers-panel">
      <h3 data-testid="movers-title">
        {copy.title}（{windowLabel}）
        {result.totalDelta !== null && (
          <span className="movers-total">
            {" · "}
            {interpolate(copy.total, { delta: formatDelta(result.totalDelta) })}
          </span>
        )}
      </h3>

      {above.map((m) => (
        <MoverRow key={m.repo.full_name} mover={m} />
      ))}

      {below.length > 0 && (
        <div className="movers-divider" data-testid="movers-divider">
          {copy.noise}
        </div>
      )}
      {below.map((m) => (
        <MoverRow key={m.repo.full_name} mover={m} />
      ))}

      {result.fallers.length > 0 && (
        <details className="movers-fallers" data-testid="movers-fallers">
          <summary>{interpolate(copy.fallers, { count: result.fallers.length })}</summary>
          {result.fallers.map((m) => (
            <MoverRow key={m.repo.full_name} mover={m} />
          ))}
        </details>
      )}
    </section>
  );
});
