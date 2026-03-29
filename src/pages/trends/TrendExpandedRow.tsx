/**
 * 趨勢表格展開列，顯示 Star 歷史圖表與詳細資訊。
 */

import { memo } from "react";
import { StarsChart } from "../../components/StarsChart";
import { TrendArrow } from "../../components/TrendArrow";
import { formatNumber, formatDelta, formatVelocity, deltaClass } from "../../utils/format";
import { useI18n } from "../../i18n";
import { useNavigation } from "../../contexts/NavigationContext";
import type { TrendingRepo } from "../../api/client";

const TREND_TABLE_COLUMNS = 10;

interface TrendExpandedRowProps {
  repo: TrendingRepo;
  onClose: () => void;
}

export const TrendExpandedRow = memo(function TrendExpandedRow({
  repo,
  onClose,
}: TrendExpandedRowProps) {
  const { t } = useI18n();
  const { navigateTo } = useNavigation();

  return (
    <tr className="trend-expanded-row" data-testid={`trend-expanded-${repo.id}`}>
      <td colSpan={TREND_TABLE_COLUMNS}>
        <div className="trend-expanded-panel">
          <div className="trend-expanded-header">
            <h3 className="trend-expanded-title">{repo.full_name}</h3>
            <div className="trend-expanded-actions">
              <button
                className="btn btn-sm btn-outline"
                onClick={() => navigateTo("compare", { preselectedIds: [repo.id] })}
                data-testid={`trend-compare-btn-${repo.id}`}
              >
                {t.trends.compareWith}
              </button>
              <button
                className="btn btn-sm btn-ghost trend-expanded-close"
                onClick={onClose}
                aria-label={t.trends.expand.collapse}
              >
                &times;
              </button>
            </div>
          </div>

          {repo.description && <p className="trend-expanded-description">{repo.description}</p>}
          {!repo.description && (
            <p className="trend-expanded-description muted">{t.trends.expand.noDescription}</p>
          )}

          <div className="trend-expanded-metrics">
            <div className="trend-metric-chip">
              <span className="trend-metric-label">{t.trends.columns.stars}</span>
              <span className="trend-metric-value">{formatNumber(repo.stars)}</span>
            </div>
            <div className="trend-metric-chip">
              <span className="trend-metric-label">{t.trends.columns.velocity}</span>
              <span className="trend-metric-value">{formatVelocity(repo.velocity)}</span>
            </div>
            <div className="trend-metric-chip">
              <span className="trend-metric-label">{t.trends.columns.delta7d}</span>
              <span className={`trend-metric-value ${deltaClass(repo.stars_delta_7d)}`}>
                {formatDelta(repo.stars_delta_7d)}
              </span>
            </div>
            <div className="trend-metric-chip">
              <span className="trend-metric-label">{t.trends.columns.delta30d}</span>
              <span className={`trend-metric-value ${deltaClass(repo.stars_delta_30d)}`}>
                {formatDelta(repo.stars_delta_30d)}
              </span>
            </div>
            {repo.language && (
              <div className="trend-metric-chip">
                <span className="trend-metric-label">{t.trends.columns.repo}</span>
                <span className="repo-language">{repo.language}</span>
              </div>
            )}
            <div className="trend-metric-chip">
              <span className="trend-metric-label">{t.repo.trend}</span>
              <TrendArrow trend={repo.trend} />
            </div>
          </div>

          <div className="trend-expanded-chart">
            <StarsChart repoId={repo.id} currentStars={repo.stars} />
          </div>
        </div>
      </td>
    </tr>
  );
});
