/**
 * 快速匯出下拉選單：JSON / CSV 下載連結。
 */

import { useCallback, useRef, useState } from "react";
import { getExportWatchlistJsonUrl, getExportWatchlistCsvUrl } from "../../api/client";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useI18n } from "../../i18n";

export function ExportDropdown() {
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
        data-testid="export-btn"
      >
        {t.watchlist.export.button}
      </button>
      {open && (
        <div className="export-dropdown-menu" role="menu" data-testid="export-menu">
          <a
            href={getExportWatchlistJsonUrl()}
            className="export-dropdown-item"
            download
            role="menuitem"
            onClick={close}
          >
            {t.watchlist.export.json}
          </a>
          <a
            href={getExportWatchlistCsvUrl()}
            className="export-dropdown-item"
            download
            role="menuitem"
            onClick={close}
          >
            {t.watchlist.export.csv}
          </a>
        </div>
      )}
    </div>
  );
}
