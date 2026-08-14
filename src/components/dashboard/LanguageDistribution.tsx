/**
 * 語言分佈圓餅圖。
 * 從追蹤 repo 的 language 欄位計算分佈，使用 Recharts PieChart。
 */

import { memo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useI18n } from "../../i18n";
import { lookupLanguageColor } from "../../constants/languageColors";

export interface LanguageSlice {
  language: string;
  count: number;
}

// 已知語言色彩來自 constants/languageColors（全 app 單一來源）；
// 未知語言用分片專屬 fallback 輪替，確保相鄰分片仍可區分。
const FALLBACK_COLORS = ["#58a6ff", "#3fb950", "#a371f7", "#d29922", "#f85149", "#79c0ff"];

function sliceColor(language: string, index: number, otherLabel: string): string {
  if (language === otherLabel) return "var(--fg-muted)";
  return lookupLanguageColor(language) ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

interface TooltipPayload {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: LanguageSlice }>;
}

function LangTooltip({ active, payload }: TooltipPayload) {
  const { t } = useI18n();
  if (!active || !payload?.length) return null;
  const { language, count } = payload[0].payload;
  return (
    <div
      style={{
        background: "var(--bg-default)",
        border: "1px solid var(--border-default)",
        borderRadius: 6,
        padding: "8px 12px",
        fontSize: 13,
        color: "var(--fg-default)",
      }}
    >
      <strong>{language}</strong>: {count} {t.dashboard.languageDistribution.repos}
    </div>
  );
}

interface Props {
  data: LanguageSlice[];
}

export const LanguageDistribution = memo(function LanguageDistribution({ data }: Props) {
  const { t } = useI18n();

  if (data.length === 0) {
    return (
      <div className="dashboard-section">
        <h3>{t.dashboard.languageDistribution.title}</h3>
        <div className="lang-dist-empty">{t.dashboard.languageDistribution.empty}</div>
      </div>
    );
  }

  return (
    <div className="dashboard-section">
      <h3>{t.dashboard.languageDistribution.title}</h3>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="language"
            cx="50%"
            cy="50%"
            innerRadius={48}
            outerRadius={80}
            paddingAngle={2}
          >
            {data.map((entry, index) => (
              <Cell
                key={entry.language}
                fill={sliceColor(entry.language, index, t.dashboard.languageDistribution.other)}
              />
            ))}
          </Pie>
          <Tooltip content={<LangTooltip />} />
          <Legend
            iconType="circle"
            iconSize={8}
            formatter={(value) => (
              <span style={{ fontSize: 12, color: "var(--fg-muted)" }}>{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
});
