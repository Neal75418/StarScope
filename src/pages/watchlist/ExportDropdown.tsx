/**
 * 快速匯出下拉選單：JSON / CSV 下載連結。
 */

import { getExportWatchlistJsonUrl, getExportWatchlistCsvUrl } from "../../api/client";
import { useI18n } from "../../i18n";
import { DropdownMenu } from "../../components/DropdownMenu";

export function ExportDropdown() {
  const { t } = useI18n();
  return (
    <DropdownMenu
      label={t.watchlist.export.button}
      buttonTestId="export-btn"
      menuTestId="export-menu"
    >
      {(close) => (
        <>
          <a
            href={getExportWatchlistJsonUrl()}
            className="export-dropdown-item"
            role="menuitem"
            download
            onClick={close}
          >
            {t.watchlist.export.json}
          </a>
          <a
            href={getExportWatchlistCsvUrl()}
            className="export-dropdown-item"
            role="menuitem"
            download
            onClick={close}
          >
            {t.watchlist.export.csv}
          </a>
        </>
      )}
    </DropdownMenu>
  );
}
