/**
 * 對比預設下拉選單：儲存 / 載入 / 刪除 preset。
 * 複用 export-dropdown CSS 結構。
 */

import { useCallback, useState } from "react";
import { useComparePresets, type SavedComparePreset } from "../../hooks/useComparePresets";
import { useI18n } from "../../i18n";
import type { ComparisonTimeRange } from "../../api/types";
import type { CompareMetric, CompareChartType } from "../Compare";
import { DropdownMenu } from "../../components/DropdownMenu";

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
  const [saveName, setSaveName] = useState("");

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

  return (
    <DropdownMenu
      label={t.compare.presets.title}
      buttonTestId="compare-presets-btn"
      menuTestId="compare-presets-menu"
      menuClassName="compare-presets-menu"
      onClose={() => setSaveName("")}
    >
      {(close) => {
        const handleApply = (preset: SavedComparePreset) => {
          onApply(preset);
          close();
        };
        return (
          <>
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
          </>
        );
      }}
    </DropdownMenu>
  );
}
