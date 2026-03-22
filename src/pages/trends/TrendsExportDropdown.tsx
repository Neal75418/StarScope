/**
 * 趨勢匯出下拉選單：JSON / CSV 下載連結，含目前篩選條件。
 */

import { getExportTrendsJsonUrl, getExportTrendsCsvUrl } from "../../api/client";
import { useI18n } from "../../i18n";
import { DropdownMenu } from "../../components/DropdownMenu";

interface TrendsExportDropdownProps {
  sortBy: string;
  language: string;
  minStars: number | null;
}

export function TrendsExportDropdown({ sortBy, language, minStars }: TrendsExportDropdownProps) {
  const { t } = useI18n();
  const langParam = language || undefined;
  const starsParam = minStars ?? undefined;

  return (
    <DropdownMenu
      label={t.trends.export.button}
      buttonTestId="trends-export-btn"
      menuTestId="trends-export-menu"
    >
      {(close) => (
        <>
          <a
            href={getExportTrendsJsonUrl(sortBy, langParam, starsParam)}
            className="export-dropdown-item"
            role="menuitem"
            download
            onClick={close}
          >
            {t.trends.export.json}
          </a>
          <a
            href={getExportTrendsCsvUrl(sortBy, langParam, starsParam)}
            className="export-dropdown-item"
            role="menuitem"
            download
            onClick={close}
          >
            {t.trends.export.csv}
          </a>
        </>
      )}
    </DropdownMenu>
  );
}
