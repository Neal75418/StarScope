/**
 * 對比匯出下拉選單：JSON / CSV 下載連結。
 */

import { getExportComparisonJsonUrl, getExportComparisonCsvUrl } from "../../api/client";
import type { ComparisonTimeRange } from "../../api/types";
import { useI18n } from "../../i18n";
import { DropdownMenu } from "../../components/DropdownMenu";

interface CompareExportDropdownProps {
  repoIds: number[];
  timeRange: ComparisonTimeRange;
  normalize: boolean;
}

export function CompareExportDropdown({
  repoIds,
  timeRange,
  normalize,
}: CompareExportDropdownProps) {
  const { t } = useI18n();
  return (
    <DropdownMenu
      label={t.compare.export.button}
      buttonTestId="compare-export-btn"
      menuTestId="compare-export-menu"
    >
      {(close) => (
        <>
          <a
            href={getExportComparisonJsonUrl(repoIds, timeRange, normalize)}
            className="export-dropdown-item"
            download
            role="menuitem"
            onClick={close}
          >
            {t.compare.export.json}
          </a>
          <a
            href={getExportComparisonCsvUrl(repoIds, timeRange, normalize)}
            className="export-dropdown-item"
            download
            role="menuitem"
            onClick={close}
          >
            {t.compare.export.csv}
          </a>
        </>
      )}
    </DropdownMenu>
  );
}
