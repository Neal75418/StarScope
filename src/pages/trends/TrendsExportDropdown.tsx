/**
 * 趨勢匯出下拉選單：JSON / CSV，含目前篩選條件。
 *
 * 不用 `<a href download>` 的理由見 watchlist/ExportDropdown；存檔流程在 utils/saveFile。
 */

import { getExportTrendsJsonUrl, getExportTrendsCsvUrl } from "../../api/client";
import { useI18n } from "../../i18n";
import { DropdownMenu } from "../../components/DropdownMenu";
import { saveExport } from "../../utils/saveFile";
import { getErrorMessage } from "../../utils/error";

interface TrendsExportDropdownProps {
  sortBy: string;
  language: string;
  minStars: number | null;
  /** 零筆結果時停用——匯出空檔案沒有意義 */
  disabled?: boolean;
  onSaved: (message: string) => void;
  onFailed: (message: string) => void;
}

export function TrendsExportDropdown({
  sortBy,
  language,
  minStars,
  disabled,
  onSaved,
  onFailed,
}: TrendsExportDropdownProps) {
  const { t } = useI18n();
  const copy = t.trends.export;
  const langParam = language || undefined;
  const starsParam = minStars ?? undefined;

  const run = async (url: string, fallbackName: string) => {
    try {
      if ((await saveExport(url, fallbackName)) === "saved") onSaved(copy.saved);
    } catch (err) {
      onFailed(copy.failed.replace("{error}", getErrorMessage(err, t.common.error)));
    }
  };

  return (
    <DropdownMenu
      label={copy.button}
      buttonTestId="trends-export-btn"
      menuTestId="trends-export-menu"
      disabled={disabled}
    >
      {(close) => (
        <>
          <button
            type="button"
            className="export-dropdown-item"
            role="menuitem"
            onClick={() => {
              close();
              void run(
                getExportTrendsJsonUrl(sortBy, langParam, starsParam),
                "starscope_trends.json"
              );
            }}
          >
            {copy.json}
          </button>
          <button
            type="button"
            className="export-dropdown-item"
            role="menuitem"
            onClick={() => {
              close();
              void run(
                getExportTrendsCsvUrl(sortBy, langParam, starsParam),
                "starscope_trends.csv"
              );
            }}
          >
            {copy.csv}
          </button>
        </>
      )}
    </DropdownMenu>
  );
}
