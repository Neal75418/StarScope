/**
 * 對比匯出下拉選單：JSON / CSV 下載連結。
 */

import { useCallback, useRef, useState } from "react";
import { getExportComparisonJsonUrl, getExportComparisonCsvUrl } from "../../api/client";
import type { ComparisonTimeRange } from "../../api/types";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useI18n } from "../../i18n";

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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close, open);

  return (
    <div className="export-dropdown" ref={ref}>
      <button
        className="btn btn-sm"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="true"
        data-testid="compare-export-btn"
      >
        {t.compare.export.button}
      </button>
      {open && (
        <div className="export-dropdown-menu" role="menu" data-testid="compare-export-menu">
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
        </div>
      )}
    </div>
  );
}
