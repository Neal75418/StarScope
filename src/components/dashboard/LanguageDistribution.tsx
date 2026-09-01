/**
 * 語言分佈橫向長條圖。
 *
 * 原本是甜甜圈。實測那個版本要讀出一個數字得做四件事：在圖例找到語言、記住顏色、
 * 回圓環上找回那個顏色、再把滑鼠停上去——因為
 *   1. Recharts 把圖例照字母重排，而資料是照數量排的，兩份清單順序不一致
 *   2. 整個面板沒有任何數字，數值只存在於 tooltip
 *   3. 最大的兩塊 TypeScript(#3178c6) 與 Python(#3572A5) 加權色距只有 56.8，
 *      是所有配對中位數 294.9 的五分之一，而且在環上相鄰
 * 長條圖把名稱、長度、數字排在同一列，順序天然就是數量序，不需要顏色配對。
 */

import { memo, useMemo } from "react";
import {
  BarChart,
  Bar,
  Rectangle,
  XAxis,
  YAxis,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
} from "recharts";
import type { BarShapeProps } from "recharts";
import { useI18n } from "../../i18n";
import { lookupLanguageColor } from "../../constants/languageColors";
import { barChartMinHeight } from "./chartLayout";

export interface LanguageSlice {
  language: string;
  count: number;
}

// 未知語言用輪替的 fallback，確保相鄰長條仍可區分。
// 顏色在這裡只是點綴——要讀的資訊已經寫在每一列上，不靠顏色傳達。
const FALLBACK_COLORS = ["#58a6ff", "#3fb950", "#a371f7", "#d29922", "#f85149", "#79c0ff"];

function barColor(language: string, index: number, otherLabel: string): string {
  if (language === otherLabel) return "var(--fg-muted)";
  return lookupLanguageColor(language) ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

interface Props {
  data: LanguageSlice[];
}

export const LanguageDistribution = memo(function LanguageDistribution({ data }: Props) {
  const { t } = useI18n();
  const otherLabel = t.dashboard.languageDistribution.other;

  // 面板高度隨語言數量長，寫死高度會讓十種語言擠成一團。
  // 算法與旁邊的增長速度分佈共用，兩張圖的列距才會一致
  const height = useMemo(() => barChartMinHeight(data.length), [data.length]);

  if (data.length === 0) {
    return (
      <div className="dashboard-section">
        <h3>{t.dashboard.languageDistribution.title}</h3>
        <div className="lang-dist-empty">{t.dashboard.languageDistribution.empty}</div>
      </div>
    );
  }

  return (
    <div className="dashboard-section dashboard-section--chart" data-testid="language-distribution">
      <h3>{t.dashboard.languageDistribution.title}</h3>
      <div className="dashboard-chart-fill" data-testid="chart-area" style={{ minHeight: height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 40, left: 8, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 11, fill: "var(--fg-muted)" }}
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              dataKey="language"
              type="category"
              tick={{ fontSize: 12, fill: "var(--fg-muted)" }}
              width={116}
              axisLine={false}
              tickLine={false}
            />
            {/* isAnimationActive={false}：Recharts 會等長條動畫跑完才畫 LabelList，
                數字要慢一拍才出現——而數字正是這次改版的重點。靜態的分佈本來也
                不需要長出來的動畫 */}
            <Bar
              dataKey="count"
              radius={[0, 4, 4, 0]}
              maxBarSize={16}
              isAnimationActive={false}
              // shape 取代 Cell（Cell 在 Recharts 4 會被移除）
              shape={(props: BarShapeProps) => {
                const entry = data[props.index];
                return (
                  <Rectangle {...props} fill={barColor(entry.language, props.index, otherLabel)} />
                );
              }}
            >
              {/* 數字直接標在長條末端：沒有它就得靠 hover 才知道數量，
                  而使用者掃儀表板時不會逐個 hover */}
              <LabelList
                dataKey="count"
                position="right"
                style={{ fill: "var(--fg-muted)", fontSize: 11 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
