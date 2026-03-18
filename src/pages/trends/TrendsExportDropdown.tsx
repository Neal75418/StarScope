/**
 * 趨勢匯出下拉選單：JSON / CSV 下載連結，含目前篩選條件。
 */

import { useCallback, useRef, useState } from "react";
import { getExportTrendsJsonUrl, getExportTrendsCsvUrl } from "../../api/client";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useI18n } from "../../i18n";

interface TrendsExportDropdownProps {
  sortBy: string;
  language: string;
  minStars: number | null;
}

export function TrendsExportDropdown({ sortBy, language, minStars }: TrendsExportDropdownProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close, open);

  const langParam = language || undefined;
  const starsParam = minStars ?? undefined;

  return (
    <div className="export-dropdown" ref={ref}>
      <button
        className="btn btn-sm"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="true"
        data-testid="trends-export-btn"
      >
        {t.trends.export.button}
      </button>
      {open && (
        <div className="export-dropdown-menu" role="menu" data-testid="trends-export-menu">
          <a
            href={getExportTrendsJsonUrl(sortBy, langParam, starsParam)}
            className="export-dropdown-item"
            download
            role="menuitem"
            onClick={close}
          >
            {t.trends.export.json}
          </a>
          <a
            href={getExportTrendsCsvUrl(sortBy, langParam, starsParam)}
            className="export-dropdown-item"
            download
            role="menuitem"
            onClick={close}
          >
            {t.trends.export.csv}
          </a>
        </div>
      )}
    </div>
  );
}
