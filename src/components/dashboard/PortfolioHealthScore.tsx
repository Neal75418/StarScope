/**
 * Portfolio 健康分數。
 * 依活躍警報、速度分佈、訊號覆蓋率計算 0-100 的複合分數。
 */

import { memo } from "react";
import { useI18n } from "../../i18n";

export interface HealthScoreInput {
  score: number | null; // 0-100，null 表示無資料
  activeAlerts: number;
  totalRepos: number;
  reposWithSignals: number;
  highVelocityRepos: number; // velocity 分佈 high + veryHigh 的數量
  staleRepos: number; // velocity <= 0 的數量
}

type HealthRating = "excellent" | "good" | "fair" | "poor";

function getRating(score: number): HealthRating {
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 40) return "fair";
  return "poor";
}

const RATING_COLORS: Record<HealthRating, string> = {
  excellent: "var(--success-fg)",
  good: "var(--accent-fg)",
  fair: "var(--warning-fg)",
  poor: "var(--danger-fg)",
};

interface GaugeProps {
  score: number;
  color: string;
}

// 半圓形 SVG 量規
function ScoreGauge({ score, color }: GaugeProps) {
  const radius = 48;
  const circumference = Math.PI * radius; // 半圓圓周
  const progress = (score / 100) * circumference;

  return (
    <svg width={120} height={70} viewBox="0 0 120 70" className="health-gauge">
      {/* 背景半圓 */}
      <path
        d="M 12 60 A 48 48 0 0 1 108 60"
        fill="none"
        stroke="var(--bg-muted)"
        strokeWidth={10}
        strokeLinecap="round"
      />
      {/* 進度半圓 */}
      <path
        d="M 12 60 A 48 48 0 0 1 108 60"
        fill="none"
        stroke={color}
        strokeWidth={10}
        strokeLinecap="round"
        strokeDasharray={`${progress} ${circumference}`}
        style={{ transition: "stroke-dasharray 0.6s ease" }}
      />
      {/* 分數文字 */}
      <text x="60" y="54" textAnchor="middle" fontSize="22" fontWeight="600" fill={color}>
        {score}
      </text>
    </svg>
  );
}

interface Props {
  input: HealthScoreInput;
}

export const PortfolioHealthScore = memo(function PortfolioHealthScore({ input }: Props) {
  const { t } = useI18n();

  if (input.score === null || input.totalRepos === 0) {
    return (
      <div className="dashboard-section health-score-section">
        <h3>{t.dashboard.healthScore.title}</h3>
        <div className="health-score-empty">{t.dashboard.healthScore.noData}</div>
      </div>
    );
  }

  const rating = getRating(input.score);
  const color = RATING_COLORS[rating];

  return (
    <div className="dashboard-section health-score-section">
      <h3>{t.dashboard.healthScore.title}</h3>
      <div className="health-score-body">
        <div className="health-gauge-wrap">
          <ScoreGauge score={input.score} color={color} />
          <div className="health-rating" style={{ color }}>
            {t.dashboard.healthScore.ratings[rating]}
          </div>
        </div>
        <div className="health-factors">
          <div className="health-factor">
            <span className="health-factor-label">{t.dashboard.healthScore.activeAlerts}</span>
            <span
              className="health-factor-value"
              style={{ color: input.activeAlerts > 0 ? "var(--danger-fg)" : "var(--success-fg)" }}
            >
              {input.activeAlerts}
            </span>
          </div>
          <div className="health-factor">
            <span className="health-factor-label">{t.dashboard.healthScore.withSignals}</span>
            <span className="health-factor-value" style={{ color: "var(--accent-fg)" }}>
              {input.reposWithSignals}/{input.totalRepos}
            </span>
          </div>
          <div className="health-factor">
            <span className="health-factor-label">{t.dashboard.healthScore.highVelocity}</span>
            <span className="health-factor-value" style={{ color: "var(--success-fg)" }}>
              {input.highVelocityRepos}
            </span>
          </div>
          <div className="health-factor">
            <span className="health-factor-label">{t.dashboard.healthScore.stale}</span>
            <span
              className="health-factor-value"
              style={{ color: input.staleRepos > 0 ? "var(--fg-muted)" : "var(--success-fg)" }}
            >
              {input.staleRepos}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
});
