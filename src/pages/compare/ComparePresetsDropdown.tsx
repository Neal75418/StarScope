/**
 * 對比預設下拉選單：儲存 / 載入 / 刪除 preset。
 * 複用 export-dropdown CSS 結構。
 */

import { useCallback, useRef, useState } from "react";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useComparePresets, type SavedComparePreset } from "../../hooks/useComparePresets";
import { useI18n } from "../../i18n";
import type { ComparisonTimeRange } from "../../api/types";
import type { CompareMetric, CompareChartType } from "../Compare";

interface ComparePresetsDropdownProps {
  repoIds: number[];
  timeRange: ComparisonTimeRange;
  normalize: boolean;
  metric: CompareMetric;
  chartType: CompareChartType;
  logScale: boolean;
  showGrowthRate: boolean;
  onApply: (preset: SavedComparePreset) => void;
}

export function ComparePresetsDropdown({
  repoIds,
  timeRange,
  normalize,
  metric,
  chartType,
  logScale,
  showGrowthRate,
  onApply,
}: ComparePresetsDropdownProps) {
  const { t } = useI18n();
  const { presets, savePreset, deletePreset } = useComparePresets();
  const [open, setOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setSaveName("");
  }, []);
  useClickOutside(ref, close, open);

  const handleSave = useCallback(() => {
    savePreset(saveName, {
      repoIds,
      timeRange,
      normalize,
      metric,
      chartType,
      logScale,
      showGrowthRate,
    });
    setSaveName("");
  }, [
    saveName,
    repoIds,
    timeRange,
    normalize,
    metric,
    chartType,
    logScale,
    showGrowthRate,
    savePreset,
  ]);

  const handleApply = useCallback(
    (preset: SavedComparePreset) => {
      onApply(preset);
      close();
    },
    [onApply, close]
  );

  return (
    <div className="export-dropdown" ref={ref}>
      <button
        className="btn btn-sm"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="true"
        data-testid="compare-presets-btn"
      >
        {t.compare.presets.title}
      </button>
      {open && (
        <div
          className="export-dropdown-menu compare-presets-menu"
          role="menu"
          data-testid="compare-presets-menu"
        >
          <div className="compare-presets-save">
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder={t.compare.presets.namePlaceholder}
              className="compare-presets-input"
              data-testid="compare-presets-name-input"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
            />
            <button
              className="btn btn-sm"
              onClick={handleSave}
              data-testid="compare-presets-save-btn"
            >
              {t.compare.presets.saveCurrent}
            </button>
          </div>
          {presets.length === 0 ? (
            <div className="compare-presets-empty">{t.compare.presets.empty}</div>
          ) : (
            presets.map((preset) => (
              <div key={preset.id} className="compare-presets-item" role="menuitem">
                <button
                  className="compare-presets-apply"
                  onClick={() => handleApply(preset)}
                  data-testid={`compare-preset-${preset.id}`}
                >
                  {preset.name}
                </button>
                <button
                  className="compare-presets-delete btn btn-sm"
                  onClick={() => deletePreset(preset.id)}
                  data-testid={`compare-preset-delete-${preset.id}`}
                >
                  {t.compare.presets.delete}
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
