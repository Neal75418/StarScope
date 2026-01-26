/**
 * Individual score row component.
 */

import { getScoreColor } from "./healthScoreUtils";

interface ScoreRowProps {
  label: string;
  score: number | null;
  detail?: string;
  weight: string;
}

export function ScoreRow({ label, score, detail, weight }: ScoreRowProps) {
  return (
    <div className="score-row">
      <div className="score-label">
        <span className="label-text">{label}</span>
        <span className="weight-text">{weight}</span>
      </div>
      <div className="score-bar-container">
        <div
          className="score-bar"
          style={{
            width: `${score ?? 0}%`,
            backgroundColor: getScoreColor(score),
          }}
        />
      </div>
      <div className="score-value" style={{ color: getScoreColor(score) }}>
        {score !== null ? score.toFixed(0) : "—"}
      </div>
      {detail && <div className="score-detail">{detail}</div>}
    </div>
  );
}
