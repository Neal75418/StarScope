/**
 * Signal toolbar with filters and actions.
 */

import { EarlySignalType, EarlySignalSeverity } from "../../api/client";
import { useSignalLabels } from "./signalLabels";

interface SignalToolbarProps {
  filterType: EarlySignalType | "";
  setFilterType: (val: EarlySignalType | "") => void;
  filterSeverity: EarlySignalSeverity | "";
  setFilterSeverity: (val: EarlySignalSeverity | "") => void;
  showAcknowledged: boolean;
  setShowAcknowledged: (val: boolean) => void;
  hasUnacknowledged: boolean;
  isDetecting: boolean;
  onAcknowledgeAll: () => void;
  onRunDetection: () => void;
}

export function SignalToolbar({
  filterType,
  setFilterType,
  filterSeverity,
  setFilterSeverity,
  showAcknowledged,
  setShowAcknowledged,
  hasUnacknowledged,
  isDetecting,
  onAcknowledgeAll,
  onRunDetection,
}: SignalToolbarProps) {
  const { signalTypeLabels, severityLabels, t } = useSignalLabels();

  return (
    <div className="signals-toolbar" data-testid="signals-toolbar">
      <div className="signals-filters" data-testid="signals-filters">
        <select
          data-testid="filter-type"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as EarlySignalType | "")}
          className="signals-select"
        >
          <option value="">{t.signals.toolbar.allTypes}</option>
          <option value="rising_star">{signalTypeLabels.rising_star}</option>
          <option value="sudden_spike">{signalTypeLabels.sudden_spike}</option>
          <option value="breakout">{signalTypeLabels.breakout}</option>
          <option value="viral_hn">{signalTypeLabels.viral_hn}</option>
          <option value="release_surge">{signalTypeLabels.release_surge}</option>
        </select>

        <select
          data-testid="filter-severity"
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value as EarlySignalSeverity | "")}
          className="signals-select"
        >
          <option value="">{t.signals.toolbar.allSeverities}</option>
          <option value="high">{severityLabels.high}</option>
          <option value="medium">{severityLabels.medium}</option>
          <option value="low">{severityLabels.low}</option>
        </select>

        <label className="signals-checkbox">
          <input
            type="checkbox"
            checked={showAcknowledged}
            onChange={(e) => setShowAcknowledged(e.target.checked)}
          />
          {t.signals.toolbar.showAcknowledged}
        </label>
      </div>

      <div className="signals-actions">
        <button
          className="btn btn-secondary"
          onClick={onAcknowledgeAll}
          disabled={!hasUnacknowledged}
        >
          {t.signals.actions.acknowledgeAll}
        </button>
        <button className="btn btn-primary" onClick={onRunDetection} disabled={isDetecting}>
          {isDetecting ? t.signals.toolbar.detecting : t.signals.toolbar.runDetection}
        </button>
      </div>
    </div>
  );
}
