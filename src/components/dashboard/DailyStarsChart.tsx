/**
 * 每日新增星數長條圖。
 *
 * 取代原本的「組合星數歷史」折線。那張折線畫的是總星數，8.42M 的基數上
 * 一週漲 1.28%——實測折線垂直跨度 1.3px、繪圖區 126px，永遠是一條水平線。
 * 換成增量之後 Y 軸從 0 起算才有意義，同樣的資料就回到看得見的尺度。
 *
 * 換算規則（含缺口攤平、今天未過完、清單成分變動）在 utils/dailyStars.ts。
 * 這裡只負責把那些標記畫出來——推估與未完成的長條用半透明區隔，
 * 並在圖下方寫明，讓人不用 hover 就知道哪幾根不能全信。
 */

import { memo, useMemo } from "react";
import {
  BarChart,
  Bar,
  Rectangle,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { BarShapeProps } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { getPortfolioHistory } from "../../api/client";
import type { DashboardTimeRange } from "../../api/types";
import { queryKeys } from "../../lib/react-query";
import { formatNumber, formatDelta } from "../../utils/format";
import { computeDailyStars, starAxisTicks, type DailyStarBar } from "../../utils/dailyStars";
import { Skeleton } from "../Skeleton";
import { useI18n } from "../../i18n";

const TIME_RANGE_OPTIONS: DashboardTimeRange[] = [7, 14, 30];

// 推估與未完成的長條調淡。純色會讓它們看起來跟實測值一樣可信
const UNCERTAIN_OPACITY = 0.4;

function formatXDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function formatYTick(value: number): string {
  if (Math.abs(value) < 1_000) return String(value);
  // 一律四捨五入到整數 K 的話，1,500 與 2,000 都會標成 "2K"
  const k = value / 1_000;
  return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
}

interface TooltipPayload {
  active?: boolean;
  payload?: Array<{ payload: DailyStarBar }>;
}

function DailyStarsTooltip({ active, payload }: TooltipPayload) {
  const { t } = useI18n();
  if (!active || !payload?.length) return null;
  const bar = payload[0].payload;
  const copy = t.dashboard.dailyStars;

  // 每個註記都直接寫出來。只靠顏色深淺的話，看到淡色也不知道淡在哪裡
  const notes: string[] = [];
  if (bar.spanDays > 1) notes.push(copy.noteEstimated.replace("{days}", String(bar.spanDays)));
  if (bar.partial) notes.push(copy.notePartial);
  if (bar.membershipChanged) notes.push(copy.noteMembership);

  return (
    <div className="daily-stars-tooltip">
      <div className="daily-stars-tooltip__date">{formatXDate(bar.date)}</div>
      <div>
        <strong>{formatDelta(bar.stars)}</strong> {copy.stars}
      </div>
      {notes.map((note) => (
        <div key={note} className="daily-stars-tooltip__note">
          {note}
        </div>
      ))}
    </div>
  );
}

interface Props {
  days: DashboardTimeRange;
  onChangeDays: (days: DashboardTimeRange) => void;
}

export const DailyStarsChart = memo(function DailyStarsChart({ days, onChangeDays }: Props) {
  const { t } = useI18n();
  const copy = t.dashboard.dailyStars;

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.dashboard.portfolioHistory(days),
    queryFn: ({ signal }) => getPortfolioHistory(days, signal),
  });

  // 快照日期由後端以 UTC 產生。用本地日期比對，跨日前後會標錯「今天」
  const todayUtc = new Date().toISOString().slice(0, 10);
  const result = useMemo(
    () => computeDailyStars(data?.history ?? [], days, todayUtc),
    [data, days, todayUtc]
  );
  const ticks = useMemo(() => starAxisTicks(result.bars), [result.bars]);

  return (
    <div className="dashboard-section daily-stars-section">
      <div className="daily-stars-header">
        <div>
          <h3>{copy.title}</h3>
          {result.bars.length > 0 && (
            <p className="daily-stars-summary">
              {copy.summary
                .replace("{days}", String(result.coverageDays))
                .replace("{total}", formatDelta(result.totalGained))
                .replace("{repos}", formatNumber(result.repoCount))}
            </p>
          )}
        </div>
        <div className="dashboard-time-range">
          {TIME_RANGE_OPTIONS.map((opt) => (
            <button
              key={opt}
              className={`time-range-btn${days === opt ? " time-range-btn--active" : ""}`}
              onClick={() => onChangeDays(opt)}
            >
              {copy.dayRange.replace("{n}", String(opt))}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <Skeleton width="100%" height={160} variant="rounded" style={{ marginTop: 8 }} />
      )}

      {error && <div className="daily-stars-empty">{copy.loadError}</div>}

      {data && result.bars.length === 0 && !isLoading && (
        <div className="daily-stars-empty">{copy.noData}</div>
      )}

      {result.bars.length > 0 && (
        <>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={result.bars} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatXDate}
                tick={{ fontSize: 11, fill: "var(--fg-muted)" }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <YAxis
                tickFormatter={formatYTick}
                tick={{ fontSize: 11, fill: "var(--fg-muted)" }}
                axisLine={false}
                tickLine={false}
                width={44}
                ticks={ticks}
                domain={[ticks[0], ticks[ticks.length - 1]]}
              />
              <Tooltip
                content={<DailyStarsTooltip />}
                cursor={{ fill: "var(--bg-muted)", opacity: 0.4 }}
              />
              {/* maxBarSize 放寬到 48：只有 7 天資料時 28px 的長條會在寬面板裡顯得零星。
                  30 天時每個 band 約 40px，這個上限不會生效 */}
              <Bar
                dataKey="stars"
                radius={[3, 3, 0, 0]}
                maxBarSize={48}
                isAnimationActive={false}
                // shape 取代 Cell（Cell 在 Recharts 4 會被移除）。
                // 用 Recharts 附在這根長條上的 payload 回查，不能用 props.index 去索引
                // result.bars：資料縮短的那一次 render，Recharts 的 store 要到 effect 才
                // 更新，Bar 仍拿舊資料的 rectangle 呼叫 shape，index 會超過新陣列長度——
                // 第三方審查以 30→7 天切換重現過整頁被 ErrorBoundary 換掉。舊的 Cell
                // 路徑有 cells[index] && 守著，遷移時漏了。payload 跟正在畫的那根永遠一致。
                shape={(props: BarShapeProps) => {
                  const bar = props.payload as DailyStarBar | undefined;
                  return (
                    <Rectangle
                      {...props}
                      fill={bar && bar.stars < 0 ? "var(--danger-fg)" : "var(--accent-fg)"}
                      fillOpacity={bar && (bar.spanDays > 1 || bar.partial) ? UNCERTAIN_OPACITY : 1}
                    />
                  );
                }}
              />
            </BarChart>
          </ResponsiveContainer>

          {/* 淡色長條的意思寫在圖下面。只靠 hover 說明的話，不會有人去 hover */}
          {(result.hasEstimates || result.bars.some((b) => b.partial)) && (
            <p className="daily-stars-footnote">
              {result.hasEstimates && copy.footnoteEstimated}
              {result.hasEstimates && result.bars.some((b) => b.partial) && " · "}
              {result.bars.some((b) => b.partial) && copy.footnotePartial}
            </p>
          )}
          {result.hasMembershipChange && (
            <p className="daily-stars-footnote">{copy.footnoteMembership}</p>
          )}
          {result.coverageDays < result.requestedDays && (
            <p className="daily-stars-footnote">
              {copy.footnoteCoverage
                .replace("{coverage}", String(result.coverageDays))
                .replace("{requested}", String(result.requestedDays))}
            </p>
          )}
        </>
      )}
    </div>
  );
});
